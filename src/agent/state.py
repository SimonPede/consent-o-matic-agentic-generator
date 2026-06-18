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
    current_ruleset_draft: str
    last_test_result: dict | None #used to make logging easier
    test_ruleset_count: int
    analyse_screenshot_count: int
    final_result: dict | None

#failed_selectors removed: the last_error field already contains selector failure
#information (e.g. "ACTION_TARGET_NOT_FOUND: [selector]") as emitted by the
#patched Action.js. Maintaining a separate list was redundant and error-prone
#since it required additional parsing logic in tool_node.
# class AgentState(TypedDict):
#     messages: Annotated[list[AnyMessage], operator.add]
#     url: str
#     attempts: int
#     failed_selectors: list
#     human_review_count: int
#     last_error: str
#     structured_dom_info: list[dict] | None #had to change that because extract_dom does return a list of complex object(s)
#     cmp_typ: str
#     screenshot_info: dict | None
#     final_result: dict | None