from typing import Literal
from src.agent.state import AgentState
from langgraph.graph import END

def route_after_llm(state: AgentState) -> Literal["tool_node", "human_review_node", "rule_output_node"]:
    """Evaluates the final message in the stream to determine the next operational graph node."""
    #Dynamic budgeting: Each completed human feedback expands the number of allowed
    #iterations by 5
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
    Validates the presence of a successfully serialized final rule.
    
    Routes execution to graph termination if extraction criteria are fulfilled; 
    otherwise, triggers an inference loopback sequence.
    """
    if state.get("final_result"):
        return END
    
    return "llm_node"