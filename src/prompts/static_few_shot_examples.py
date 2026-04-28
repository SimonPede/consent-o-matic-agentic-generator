import json
import os


#TODO: write in system prompt:
#Note: The HTML and element lists in the examples below have been heavily minified for brevity.
#In real tasks, you will receive full, unedited DOM structures, but the extraction and mapping logic remains exactly the same.

def _load(filename):
    path = os.path.join(os.path.dirname(__file__), "examples", filename)
    with open(path, "r", encoding = "utf-8") as f:
        return json.load(f)

def _format(title, dom, ruleset):
    return f"""
		## Example: {title}

		### Extracted DOM:
		{json.dumps(_slim_dom(dom), indent = 2)}

		### Correct ruleset:
		{json.dumps(ruleset, indent = 2)}

		---
	"""

def _slim_dom(dom):
    result = []
    for frame in dom:
        slim = {
            "frameUrl": frame["frameUrl"],
            "cmpType": frame["cmpType"],
            "isMainFrame":  frame["isMainFrame"],
            "cmpType":  frame["cmpType"],
            "data": {
                "buttons": _slim_buttons(frame["data"]["buttons"]),
                "checkboxes": _slim_checkboxes(frame["data"]["checkboxes"]),
                "toggles": _slim_toggles(frame["data"]["toggles"]),
                "cmpType": frame["data"]["cmpType"],
                "cmpSelector": frame["data"].get("cmpSelector"),
                "cmpContainerFound": frame["data"]["cmpContainerFound"],
                "url": frame["data"]["url"],
                #leaving out filteredHtml for few-shot
            }
        }
        if frame.get("settings"):
            slim["settings"] = {
                "buttons": _slim_buttons(frame["settings"]["buttons"]),
                "checkboxes": _slim_checkboxes(frame["settings"]["checkboxes"]),
                "toggles": _slim_toggles(frame["settings"]["toggles"]),
                "cmpType": frame["settings"]["cmpType"],
                "cmpSelector": frame["settings"].get("cmpSelector"),
                "cmpContainerFound": frame["settings"]["cmpContainerFound"],
                "url": frame["settings"]["url"],
            }
        result.append(slim)
    return result

def _slim_buttons(buttons):
    return [{
        "text": b["text"],
        "tag": b["tag"],
        # "attributes": b["attributes"],
        "selector": b["selector"],
        "selectorConfidence": b["selectorConfidence"],
        "role": b.get("role"),
        "isDisabled": b["isDisabled"]
    } for b in buttons]
    
def _slim_checkboxes(checkboxes):
    return [{
        "labelText": c["labelText"],
        "tag": c["tag"],
        "selector": c["selector"],
        "selectorConfidence": c["selectorConfidence"],
        "isChecked": c["isChecked"],
        "isDisabled": c["isDisabled"]
    } for c in checkboxes]

def _slim_toggles(toggles):
    return [{
        "text": t["text"],
        "tag": t["tag"],
        "selector": t["selector"],
        "selectorConfidence": t["selectorConfidence"],
        "ariaChecked": t["ariaChecked"],
        "isDisabled": t["isDisabled"]
    } for t in toggles]
    
FEW_SHOT_EXAMPLES = (
    _format(
        "Cookiebot CMP (cookiebot.com)",
        _load("cookiebot_dom.json"),
        _load("cookiebot_ruleset.json")
    ) +
    _format(
        "Swedbank – custom banner (swedbank.com)",
        _load("swedbank_dom.json"),
        _load("swedbank_ruleset.json")
    )
)