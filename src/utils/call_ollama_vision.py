import os
import json
import requests

def call_ollama_vision(base64_image: str) -> dict:
    """
    Sends a base64-encoded screenshot taken by Puppeteer to the local Ollama vision model
    to analyze the visual state of the cookie consent banner.
    """
    
    ollama_url = os.getenv("OLLAMA_BASE_URL")
    ollama_token = os.getenv("OLLAMA_BEARER_TOKEN")
    
    prompt = """
	You are analyzing a screenshot of a website AFTER an automated script tried to interact with or dismiss a cookie consent banner.
	Independent data shows the banner or its settings menu might still be visible or stuck.

	Analyze the screenshot and return ONLY a valid JSON object with exactly these fields, nothing else.
	No explanation, no markdown, no code blocks.

	{
		"bannerVisible": true if a banner, overlay, or configuration sub-menu is still visible, false otherwise,
		"bannerDismissed": true if no banner or menu is visible on screen,
		"bannerPosition": "top", "bottom", "center", "full-screen" or null if no banner,
		"cmpType": name of the CMP if recognizable (e.g. "OneTrust", "Cookiebot"), or null,
		"settingsButtonVisible": true if a settings, preferences, or "Save/Confirm" button is visible,
		"buttons": [
			{
				"text": visible button label (e.g., "Save Choices", "Confirm My Selection", "Back"),
				"colour": dominant button colour,
				"position": "left", "center", "right"
			}
		]
	}

	If no banner/menu is visible, return bannerVisible: false, bannerDismissed: true, and an empty buttons array.
	"""
    
    try:
        response = requests.post(
			f"{ollama_url}/api/generate",
			headers={
				"Content-Type": "application/json",
				"Authorization": f"Bearer {ollama_token}"
			},
			json={
				"model": "gemma4:latest",
				"prompt": prompt,
				"images": [base64_image],
				"stream": False
			}
		)
        
        response.raise_for_status()
        
        data = response.json()
        
        response_text = data.get("response", "").replace("```json", "").replace("```", "").strip()
        
        try:
            return json.loads(response_text)
        except json.JSONDecodeError:
            return {"error": f"Vision response was not valid JSON: {response_text[:200]}"}
    
    except Exception as e:
        return {"error": f"Vision analysis failed: {str(e)}"}