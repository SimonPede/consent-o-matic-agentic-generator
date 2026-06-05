import subprocess
import json
import os
import requests
import os
from langchain_core.tools import tool

# ARCHITECTURAL NOTE: Tool-based Vision Extraction vs. Direct Multimodal Agent
# 
# Instead of feeding raw image data directly into the main agent's conversation loop, 
# i isolate the multimodal inference within this tool for several reasons:
#
# 1. Separation of Concerns: Keeps the main agent focused on code generation 
#    and ruleset logic, preventing "prompt pollution" and keeping the system prompt lean.
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
    Captures a screenshot of the given URL and performs visual analysis 
    of the cookie consent banner using a multimodal LLM.
    
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
    

    Note: The banner may not be visible if it has already been dismissed 
    or if it only appears after user interaction. A missing banner in the 
    screenshot does not necessarily mean no banner exists.
        
    Args:
        url: The URL of the website for which a ruleset is being generated.
    
    Returns:
        Structured JSON string containing: bannerVisible (bool), bannerDismissed (bool), 
        bannerPosition (string), cmpType(string), settingsButtonVisible (bool),
        buttons (list of objects with text, colour, and position).
    """
    
    print("Screenshot tool started!")
    
    script_path = os.path.join(os.path.dirname(__file__), "analyse_screenshot.js")

    try:
        result = subprocess.run(
            ["node", script_path, url],
            capture_output = True,
            text = True,
            timeout = 300,
        )

        lines = [line for line in result.stdout.strip().splitlines() if line]
        
        node_output = json.loads(lines[-1])
        base64_image = node_output.get("screenshot")
        
        if not base64_image:
            return json.dumps({"error": "No screenshot data received from browser"})
        
        ollama_url = os.getenv("OLLAMA_BASE_URL")
        ollama_token = os.getenv("OLLAMA_BEARER_TOKEN")

        response = requests.post(
            f"{ollama_url}/api/generate",
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {ollama_token}"
            },
            json = {
                "model": "gemma4:latest",
                "prompt": """
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

                If no banner is visible, return banner_visible: false, banner_dismissed: true, and an empty buttons array.
                """,
                "images": [base64_image],
                "stream": False
            }
        )
        
        response.raise_for_status()
        
        data = response.json()
        
        response_text = data.get("response", "").replace("```json", "").replace("```", "").strip()
        
        return response_text

    except Exception as e:
        return json.dumps({"handled": False, "error": str(e)})