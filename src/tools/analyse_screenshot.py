import subprocess
import json
import os
import requests
from langchain_core.tools import tool

# ARCHITECTURAL NOTE: Tool-based Vision Extraction vs. Direct Multimodal Agent
# 
# Instead of feeding raw image data directly into the main agent's conversation loop, 
# this system isolates the multimodal inference within this specialized tool for several key reasons:
#
# 1. Separation of Concerns: Keeps the main agent focused on code generation 
#    and rule logic, preventing "prompt pollution" and keeping the system prompt lean.
#
# 2. Token & Context Efficiency: Images consume massive amounts of tokens and draw heavy
#    attention weights. Passing raw images into the main chat history would quickly exhaust 
#    the context window and cause the model to forget earlier execution steps.
#
# 3. Deterministic API: Transforming high-dimensional pixel data into a low-dimensional, 
#    structured JSON schema gives the main agent a predictable, fact-based interface 
#    to reason about.
#
# 4. Model Agnosticism: This decoupled approach allows us to swap or upgrade the main 
#    code-generation LLM and the local vision model (Ollama) completely independently.

@tool
def analyse_screenshot(url: str) -> str:
    """
    Captures a screenshot of the INITIAL landing state (fresh page load) of the given URL 
    and performs visual analysis of the cookie consent banner using a multimodal LLM.
    
    Call this tool when:
    - The extracted DOM is ambiguous and you cannot confidently identify 
        banner elements from structured data alone
    - Button texts are missing or obfuscated in the HTML but may be 
        visible in the rendered page
    - You need to verify the visual layout of the banner (e.g. which 
        buttons are visually prominent, their colour or positioning)
    - The structured extraction returned no elements but a banner 
        may still be present in the rendered UI
    
    Do NOT call this tool if:
    - The structured DOM already provides sufficient selectors with 
        high confidence
    - You have already called this tool for the same URL in this session
    - You want to inspect a subpage, a settings menu, or the state AFTER 
        interacting with the banner (this tool ONLY performs a fresh, initial page load)

    Note: This tool triggers a completely clean, isolated browser navigation. It cannot 
    persist previous click states or open configuration menus. A missing banner in the 
    screenshot does not necessarily mean no banner exists; it may require user interaction 
    or have been dismissed in a different context.
        
    Args:
        url: The URL of the website for which a rule is being generated.
    
    Returns:
        Structured JSON string containing: bannerVisible (bool), bannerDismissed (bool), 
        bannerPosition (string), cmpType(string), settingsButtonVisible (bool),
        buttons (list of objects with text, colour, and position).
    """
    llm_backend = os.getenv("LLM_BACKEND", "litellm").strip().lower()
    
    print("Screenshot tool started!")
    
    script_path = os.path.join(os.path.dirname(__file__), "analyse_screenshot.js")

    result = subprocess.run(
        ["node", script_path, url],
        capture_output=True,
        text=True,
        timeout=300,
    )

    lines = [line for line in result.stdout.strip().splitlines() if line]
    
    node_output = json.loads(lines[-1])
    base64_image = node_output.get("screenshot")
    
    if not lines:
        return json.dumps({"error": "No output received from headless browser script"})
    
    if not base64_image:
        return json.dumps({"error": "No screenshot data received from browser"})
    
    ollama_url = os.getenv("OLLAMA_BASE_URL")
    ollama_token = os.getenv("OLLAMA_BEARER_TOKEN")
    
    liteLlm_url = os.getenv("LITELLM_BASE_URL")
    api_key = os.getenv("LITELLM_API_KEY")
    vision_model = os.getenv("VISION_MODEL_NAME")
    
    prompt = """
    You are analyzing a screenshot of a website to identify cookie consent banners.

    Analyze the screenshot and return ONLY a valid JSON object with exactly these fields, nothing else.
    No explanation, no markdown, no code blocks.

    {
        "bannerVisible": true if a cookie consent banner is visible, false otherwise,
        "bannerDismissed": true if the banner has already been dismissed or is not present,
        "bannerPosition": "top", "bottom", "center", "full-screen" or null if no banner,
        "cmpType": name of the CMP if recognizable (e.g. "OneTrust", "Cookiebot"), or null,
        "settingsButtonVisible": true if a settings/preferences button is visible,
        "buttons": [
            {
                "text": visible button label,
                "colour": dominant button colour,
                "position": "left", "center", "right"
            }
        ]
    }

    If no banner is visible, return bannerVisible: false, bannerDismissed: true, and an empty buttons array.
    """
    try:
        response_text = ""
        if not vision_model:
            return json.dumps({"error": "Missing model configuration: set VISION_MODEL_NAME"})
        
        if llm_backend == "litellm":
            response = requests.post(
                f"{liteLlm_url}/chat/completions",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}"
                },
                json={
                    "model": vision_model,
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {
                                    "type": "text",
                                    "text": prompt
                                },
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:image/jpeg;base64,{base64_image}"
                                    }
                                }
                            ]
                        }
                    ],
                    "stream": False
                }
            )
            
            response.raise_for_status()
            
            data = response.json()
            response_text = data["choices"][0]["message"]["content"]

        elif llm_backend == "ollama":
            response = requests.post(
                f"{ollama_url}/api/generate",
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {ollama_token}"
                },
                json={
                    "model": vision_model,
                    "prompt": prompt,
                    "images": [base64_image],
                    "stream": False
                }
            )
        
            response.raise_for_status()
            
            data = response.json()
            response_text = data.get("response", "")
        else:
            return json.dumps({"error": f"Unsupported LLM_BACKEND: {llm_backend}"})
            
        cleaned_response = response_text.replace("```json", "").replace("```JSON", "").replace("```", "").strip()
        
        try:
            return cleaned_response
        except json.JSONDecodeError:
            return {"error": f"Vision response was not valid JSON: {response_text[:200]}"}
    except Exception as e:
        return {"error": f"Vision analysis failed: {str(e)}"}