from typing import TypedDict, Annotated
import operator
from langchain_core.messages import AnyMessage

class AgentState(TypedDict):
    messages: Annotated[list[AnyMessage], operator.add]
    url: str
    attempts: int
    human_review_count: int
    last_error: str
    structured_dom_info: list[dict] | None
    cmp_type: str
    screenshot_info: dict | None
    current_ruleset_draft: str
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
    
#version purely based on original agentic workflow:
# class AgentState(TypedDict):
#     messages: Annotated[list[AnyMessage], operator.add]
#     url: str
#     attempts: int
#     failed_selectors: list
#     human_review_count: int
#     last_error: str
#     raw_dom: str
#     cmp_typ: str
#     screenshot_info: dict | None
#     thread_id: str --> not needed, belongs to langgraph config
#     final_result: dict | None