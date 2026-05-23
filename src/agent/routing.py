from typing import Literal
from src.agent.state import AgentState
from langgraph.graph import END

def route_after_llm(state: AgentState) -> Literal["tool_node", "human_review_node", "ruleset_output_node"]:
    
    #each human_review gives the LLM 5 new tries
    if state.get("attempts", 0) >= 20 + (state.get("human_review_count", 0) * 5):
        return "human_review_node"
    
    last_message = state["messages"][-1]
    
    if hasattr(last_message, "tool_calls"):
        for tool_call in last_message.tool_calls:
            if tool_call["name"] == "request_human_review":
                return "human_review_node"
    
    if not last_message.tool_calls:
        return "ruleset_output_node"
    
    return "tool_node"

def route_after_ruleset(state: AgentState) -> str:
    if state.get("final_result"):
        return END
    return "llm_node"