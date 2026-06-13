import json
import os
from typing import Any, Dict, List

#FEW_SHOT_CONFIG = "cookiebot+swedbank+sourcepoint (filteredHtml: False/True/True)"
FEW_SHOT_CONFIG = "cookiebot+swedbank+sourcepoint (filteredHtml: False/False/True)"
#FEW_SHOT_CONFIG = "cookiebot+sourcepoint (filteredHtml: False/True)"
# FEW_SHOT_CONFIG = "None"

def load(filename: str) -> Any:
    """Loads a raw example JSON data from the local repository subsystem."""
    path = os.path.join(os.path.dirname(__file__), "examples", filename)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def format(title: str, dom: List[Dict[str, Any]], ruleset: Dict[str, Any], include_filtered_html: bool = False) -> str:
    """Formats a single unified few-shot example block into clean markdown notation."""
    return f"""
		## Example: {title}

		### Extracted DOM:
		{json.dumps(slim_extracted_dom(dom, include_filtered_html))}

		### Correct ruleset:
		{json.dumps(ruleset)}

		---
	"""

def slim_extracted_dom(dom: List[Dict[str, Any]], include_filtered_html: bool = False) -> List[Dict[str, Any]]:
    """Minifies the complete multi-frame DOM tree structure to conserve critical LLM token budget."""
    minified_extraction_result = []
    
    for frame in dom:
        frame_data = frame.get("data", {})
        
        slim_frame = {
            "frameUrl": frame["frameUrl"],
            "isMainFrame": frame["isMainFrame"],
            "isCookieBannerFrame": frame["isCookieBannerFrame"],
            "cmpType": frame["cmpType"],
            "data": {
                "buttons": slim_buttons(frame_data.get("buttons", [])),
                "checkboxes": slim_checkboxes(frame_data.get("checkboxes", [])),
                "toggles": slim_toggles(frame_data.get("toggles", [])),
                "cmpFound": frame_data.get("cmpFound", False),
                "cmpSelector": frame_data.get("cmpSelector"),
                "cmpType": frame_data.get("cmpType"),
                "url": frame_data.get("url"),
                "filteredHtml": frame_data.get("filteredHtml") if include_filtered_html else None
            }
        }
        
        if frame.get("settings"):
            settings_data = frame["settings"]
            
            slim_frame["settings"] = {
                "buttons": slim_buttons(settings_data.get("buttons", [])),
                "checkboxes": slim_checkboxes(settings_data.get("checkboxes", [])),
                "toggles": slim_toggles(settings_data.get("toggles", [])),
                "cmpFound": settings_data.get("cmpFound", False),
                "cmpSelector": settings_data.get("cmpSelector"),
                "cmpType": settings_data.get("cmpType"),
                "url": settings_data.get("url"),
                "filteredHtml": settings_data.get("filteredHtml") if include_filtered_html else None
            }
            
        minified_extraction_result.append(slim_frame)
        
    return minified_extraction_result

def slim_buttons(buttons: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Filters and keeps only 'essential' interactive attributes for button elements."""
    return [{
        "type": b["type"],
        "text": b["text"],
        "tag": b["tag"],
        "parentInfo": b["parentInfo"],
        "attributes": b["attributes"],
        "selector": b["selector"],
        "selectorConfidence": b["selectorConfidence"],
        "role": b.get("role"),
        "isDisabled": b["isDisabled"]
    } for b in buttons]
    
def slim_checkboxes(checkboxes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Filters and keeps only 'essential' interactive attributes for checkbox inputs."""
    return [{
        "type": c["type"],
        "labelText": c["labelText"],
        "tag": c["tag"],
        "parentInfo": c["parentInfo"],
        "selector": c["selector"],
        "selectorConfidence": c["selectorConfidence"],
        "isChecked": c["isChecked"],
        "isDisabled": c["isDisabled"]
    } for c in checkboxes]

def slim_toggles(toggles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Filters and keeps only 'essential' interactive attributes for toggle elements."""
    return [{
        "type": t["type"],
        "text": t["text"],
        "tag": t["tag"],
        "parentInfo": t["parentInfo"],
        "selector": t["selector"],
        "selectorConfidence": t["selectorConfidence"],
        "ariaChecked": t["ariaChecked"],
        "isDisabled": t["isDisabled"]
    } for t in toggles]

if FEW_SHOT_CONFIG == "cookiebot+swedbank+sourcepoint (filteredHtml: False/True/True)":
    few_shot_examples = (
        format(
            "Cookiebot CMP (cookiebot.com)",
            load("cookiebot_dom.json"),
            load("cookiebot_ruleset.json"),
            include_filtered_html = False
        ) +
        format(
            "Swedbank, custom banner (swedbank.com)",
            load("swedbank_dom.json"),
            load("swedbank_ruleset.json"),
            include_filtered_html = True
        ) +
        format(
            "Sourcepoint CMP with Buttons (heise.de style)",
            load("sourcepoint_mock_dom.json"),
            load("sourcepoint_mock_ruleset.json"),
            include_filtered_html = True
        )
    )
elif FEW_SHOT_CONFIG == "cookiebot+swedbank+sourcepoint (filteredHtml: False/False/True)":
    few_shot_examples = (
        format(
            "Cookiebot CMP (cookiebot.com)",
            load("cookiebot_dom.json"),
            load("cookiebot_ruleset.json"),
            include_filtered_html=False
        ) +
        format(
            "Swedbank, custom banner (swedbank.com)",
            load("swedbank_dom.json"),
            load("swedbank_ruleset.json"),
            include_filtered_html=False
        ) +
        format(
            "Sourcepoint CMP with Buttons (heise.de style)",
            load("sourcepoint_mock_dom.json"),
            load("sourcepoint_mock_ruleset.json"),
            include_filtered_html=True
        )
    )
elif FEW_SHOT_CONFIG == "cookiebot+sourcepoint (filteredHtml: False/True)":
    few_shot_examples = (
        format(
            "Cookiebot CMP (cookiebot.com)",
            load("cookiebot_dom.json"),
            load("cookiebot_ruleset.json"),
            include_filtered_html=False
        ) +
        format(
            "Sourcepoint CMP with Buttons",
            load("sourcepoint_mock_dom.json"),
            load("sourcepoint_mock_ruleset.json"),
            include_filtered_html=True
        )
    )
elif FEW_SHOT_CONFIG == "None":
    few_shot_examples = (
        ""
    )