import json
import os

def _load(filename):
    path = os.path.join(os.path.dirname(__file__), "examples", filename)
    with open(path, "r", encoding = "utf-8") as f:
        return json.load(f)
    
#DEBUG: 
# dom = _load("cookiebot_dom.json")
# print("=== Frame-level keys ===")
# print(list(dom[0].keys()))
# print("\n=== data-level keys ===")
# print(list(dom[0]["data"].keys()))
# print("\n=== erster Button keys ===")
# if dom[0]["data"]["buttons"]:
#     print(list(dom[0]["data"]["buttons"][0].keys()))

def _format(title, dom, ruleset):
    return f"""
		## Example: {title}

		### Extracted DOM:
		{json.dumps(_slim_dom(dom))}

		### Correct ruleset:
		{json.dumps(ruleset)}

		---
	"""

def _slim_dom(dom):
    result = []
    for frame in dom:
        slim = {
            "frameUrl": frame["frameUrl"],
            "isMainFrame": frame["isMainFrame"],
            "isCookieBannerFrame": frame["isCookieBannerFrame"],
            "cmpType": frame["cmpType"],
            "data": {
                "buttons": _slim_buttons(frame["data"]["buttons"]),
                "checkboxes": _slim_checkboxes(frame["data"]["checkboxes"]),
                "toggles": _slim_toggles(frame["data"]["toggles"]),
                "cmpFound": frame["data"]["cmpFound"],
                "cmpSelector": frame["data"].get("cmpSelector"),
                "cmpType": frame["data"]["cmpType"],
                "url": frame["data"]["url"],
                #leaving out filteredHtml for few-shot
            }
        }
        if frame.get("settings"):
            slim["settings"] = {
                "buttons": _slim_buttons(frame["settings"]["buttons"]),
                "checkboxes": _slim_checkboxes(frame["settings"]["checkboxes"]),
                "toggles": _slim_toggles(frame["settings"]["toggles"]),
                "cmpFound": frame["settings"]["cmpFound"],
                "cmpSelector": frame["settings"].get("cmpSelector"),
                "cmpType": frame["settings"]["cmpType"],
                "url": frame["settings"]["url"],
            }
        result.append(slim)
    return result

def _slim_buttons(buttons):
    return [{
        "type": b["type"],
        "text": b["text"],
        "tag": b["tag"],
        "parentInfo": b["parentInfo"],
        # "attributes": b["attributes"], 
        "selector": b["selector"],
        "selectorConfidence": b["selectorConfidence"],
        "role": b.get("role"),
        "isDisabled": b["isDisabled"]
    } for b in buttons]
    
def _slim_checkboxes(checkboxes):
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

def _slim_toggles(toggles):
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
    
# FEW_SHOT_EXAMPLES = (
#     _format(
#         "Cookiebot CMP (cookiebot.com)",
#         _load("cookiebot_dom.json"),
#         _load("cookiebot_ruleset.json")
#     ) +
#     _format(
#         "Swedbank, custom banner (swedbank.com)",
#         _load("swedbank_dom.json"),
#         _load("swedbank_ruleset.json")
#     )
# )

FEW_SHOT_EXAMPLES = (
    _format(
        "Cookiebot CMP (cookiebot.com)",
        _load("cookiebot_dom.json"),
        _load("cookiebot_ruleset.json")
    )
)

# FEW_SHOT_EXAMPLES = (
#     ""
# )