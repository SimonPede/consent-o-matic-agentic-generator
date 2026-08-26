import os
import json
import requests

def call_vision(base64_image: str) -> dict:
    """
    Sends a base64-encoded screenshot taken by Puppeteer to the local Ollama vision model
    to analyze the visual state of the cookie consent banner.
    """
    llm_backend = os.getenv("LLM_BACKEND", "litellm").strip().lower()
    
    ollama_url = os.getenv("OLLAMA_BASE_URL")
    ollama_token = os.getenv("OLLAMA_BEARER_TOKEN")
    
    liteLlm_url = os.getenv("LITELLM_BASE_URL")
    api_key = os.getenv("LITELLM_API_KEY")
    vision_model = os.getenv("VISION_MODEL_NAME")
    
    prompt = """
    You are analyzing a screenshot of a website AFTER an automated script tried to interact with or dismiss a cookie consent banner.
    Your task is to independently verify whether the original consent interface is still active or has effectively been dismissed.
    This verification is used to cross-check heuristic banner detection and improve evaluation accuracy.

    Analyze the screenshot and return ONLY a valid JSON object with exactly these fields, nothing else.
    No explanation, no markdown, no code blocks.

    {
        "bannerVisible": true if an active consent banner, overlay, wall, or configuration sub-menu is still visible and still asks the user to make or confirm privacy choices, false otherwise,
        "bannerDismissed": true if the original consent interface is no longer active on screen, false otherwise,
        "bannerPosition": "top", "bottom", "center", "full-screen" or null if no active banner,
        "cmpType": name of the CMP if recognizable (e.g. "OneTrust", "Cookiebot"), or null,
        "settingsButtonVisible": true only if a settings/preferences/save/confirm/reject control belonging to an active consent interface is currently visible,
        "buttons": [
            {
                "text": visible button label (e.g. "Save Choices", "Confirm My Selection", "Back"),
                "color": dominant button color,
                "position": "left", "center", "right"
            }
        ]
    }

    Important classification rules:
    - Distinguish an ACTIVE consent interface from a POST-CONSENT state.
    - If the screenshot mainly shows a confirmation, success, or reassurance message such as "we respect your choice", "preferences saved", "your choices have been saved",
        or a follow-up CTA to revisit choices later, treat the banner as dismissed.
    - Do NOT classify small privacy shortcuts, floating fingerprint/privacy icons, reopen buttons, or "open settings again later" widgets as an active banner by themselves.
    - Only return bannerVisible: true when the user is still being actively asked to accept, reject, save, confirm, or configure consent choices in the currently open interface.

    If no active banner/menu is visible, return bannerVisible: false, bannerDismissed: true, bannerPosition: null, settingsButtonVisible: false, and an empty buttons array.
    """
    try:
        response_text = ""
        if not vision_model:
            return {"error": "Missing model configuration: set VISION_MODEL_NAME"}
        
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
            return {"error": f"Unsupported LLM_BACKEND: {llm_backend}"}
            
        cleaned_response = response_text.replace("```json", "").replace("```JSON", "").replace("```", "").strip()
        
        try:
            return json.loads(cleaned_response)
        except json.JSONDecodeError:
            return {"error": f"Vision response was not valid JSON: {response_text[:200]}"}
    except Exception as e:
        return {"error": f"Vision analysis failed: {str(e)}"}
