from langchain_core.tools import tool

# @tool(args_schema=CoMRuleset)
@tool
def test_ruleset(url: str, json_string: str) -> str:
    """
    Tests the generated Consent-O-Matic ruleset on the live website by 
    injecting the CoM engine and executing the defined methods. Use this 
    tool to verify whether the ruleset works correctly in practice.
    
    Call this tool when:
    - You have generated a complete ruleset and want to verify it works
    - A previous test failed and you have revised the ruleset based on 
        the error feedback
    - You want to verify whether a specific selector exists in the live DOM
        before finalising the ruleset
    
    Do NOT call this tool if:
    - You have not yet generated a complete ruleset with all required fields
    - The ruleset is clearly incomplete (e.g. missing methods or detectors)
    - You have already successfully passed this test in the current session
    
    Args:
        url: The URL of the website for which the ruleset is being tested.
        name: The name of the CMP or ruleset (e.g. "OneTrust", "Cookiebot").
        detectors: List of detector objects defining how to identify the banner.
        methods: List of method objects defining the consent actions to execute
                (HIDE_CMP, OPEN_OPTIONS, DO_CONSENT, SAVE_CONSENT).
    
    Returns:
        Structured JSON string containing: banner_disappeared (bool), 
        found_selectors (list), missing_selectors (list), 
        error (string or null).
    """
    
    return ""