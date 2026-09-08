from typing import TypedDict, Annotated
import operator
from langchain_core.messages import AnyMessage

class AgentState(TypedDict):
    messages: Annotated[list[AnyMessage], operator.add]
    url: str
    extraction_duration_seconds: float
    structured_dom_chars: int
    structured_dom_info: list[dict] | None
    cmp_type: str
    settings_extracted: bool
    batch_mode: bool
    llm_calls: int
    model_aborted: bool
    abort_reason: str
    suspected_stuck_reason: str
    human_review_count: int
    current_rule_draft: str
    last_test_result: dict | None
    test_rule_count: int
    screenshot_info: dict | None
    analyze_screenshot_count: int
    error_history: Annotated[list[str], operator.add]
    last_error: str
    final_result: dict | None