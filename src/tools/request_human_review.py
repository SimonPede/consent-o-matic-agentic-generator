from langchain_core.tools import tool

@tool
def request_human_review() -> str:
    """
    Request manual human intervention when the agent cannot make progress 
    autonomously. Use this tool sparingly and only as a last resort.
    
    Call this tool ONLY in the following situations:
    - You have attempted multiple selector combinations and all have failed validation
    - The DOM structure is ambiguous and you cannot determine the correct consent 
        categories with reasonable confidence
    - The banner structure deviates significantly from all provided few-shot examples
        and you cannot derive a plausible ruleset
    - You have received feedback from test_ruleset indicating persistent failures 
        that you cannot resolve through self-correction
    
    Do NOT call this tool if:
    - You have not yet attempted to generate a ruleset
    - A simple selector adjustment might resolve the issue
    - You have only made one or two attempts
    
    A human expert will review the extracted DOM, the current ruleset draft, 
    and all previous errors, then provide targeted feedback (e.g. the correct 
    selector, the right consent category, or a structural observation).
    Incorporate this feedback directly into your next attempt.

    Returns:
        Human feedback as a string describing what was incorrect and how to fix it.
    """
    
    return "Human review requested."