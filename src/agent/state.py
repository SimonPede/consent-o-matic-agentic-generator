from typing import TypedDict, Annotated
import operator
from langchain_core.messages import AnyMessage

class AgentState(TypedDict):
    messages: Annotated[list[AnyMessage], operator.add]
    url: str
    structured_dom_chars: int
    llm_calls: int
    human_review_count: int
    last_error: str
    error_history: Annotated[list[str], operator.add]
    structured_dom_info: list[dict] | None
    cmp_type: str
    settings_extracted: bool
    screenshot_info: dict | None
    current_rule_draft: str
    last_test_result: dict | None
    test_rule_count: int
    analyse_screenshot_count: int
    final_result: dict | None