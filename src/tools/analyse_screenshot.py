from langchain_core.tools import tool

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
        Structured JSON string containing: banner_visible (bool), 
        banner_position (string), buttons (list of objects with text, 
        colour, and position).
    """
    
    return ""