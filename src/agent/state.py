from typing import TypedDict, Annotated
import operator
from langchain_core.messages import AnyMessage

class AgentState(TypedDict):
    messages: Annotated[list[AnyMessage], operator.add]
    url: str
    attempts: int
    failed_selectors: list
    human_review_count: int
    last_error: str
    structured_dom_info: list[dict] | None #had to change that because extract_dom does return a list of complex object(s)
    cmp_typ: str
    screenshot_info: dict | None
    thread_id: str
    final_result: dict | None
    
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
#     thread_id: str
#     final_result: dict | None