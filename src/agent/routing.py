from typing import Literal
from src.agent.state import AgentState
from langgraph.graph import END

def route_after_llm(state: AgentState) -> Literal["tool_node", "human_review_node", "rule_output_node"]:
    """Routes execution after an LLM step based on tool calls and call budget."""
    #Dynamic budgeting: each completed human review increases
    #the allowed LLM-call budget by 5.
    max_llm_calls_budget = 20 + (state.get("human_review_count", 0) * 5)
    
    if state.get("llm_calls", 0) >= max_llm_calls_budget:
        return "human_review_node"
    
    last_message = state["messages"][-1]
    
    tool_calls = getattr(last_message, "tool_calls", None) or []
    
    for tool_call in tool_calls:
        if tool_call["name"] == "request_human_review":
            return "human_review_node"
    
    if not tool_calls:
        return "rule_output_node"
    
    return "tool_node"

def route_after_rule(state: AgentState) -> Literal["llm_node", "__end__"]:
    """
    Routes to END when a final rule is available or the model aborted intentionally.
    
    Otherwise, loops back to the LLM node for further refinement.
    """
    if state.get("final_result") or state.get("model_aborted") == True:
        return END
    
    return "llm_node"