import json

from langchain_core.messages import HumanMessage, ToolMessage
from langgraph.graph import StateGraph, START, END

from src.agent.llm import llm
from src.agent.nodes import (
    extraction_node,
    human_review_node,
    make_llm_node,
    rule_output_node,
)

from src.agent.state import AgentState
from src.agent.routing import route_after_llm, route_after_rule
from src.tools.analyze_screenshot import analyze_screenshot
from src.tools.test_rule import test_rule
from src.tools.request_human_review import request_human_review
from src.utils import call_vision

tools = [test_rule, request_human_review, analyze_screenshot]
tools_by_name = {tool.name: tool for tool in tools}
model_with_tools = llm.bind_tools(tools)


def tool_node(state: dict) -> dict:
    """
    Performs the automated execution sequence for intercepted LLM tool calls.
    
    Args:
        state (dict): The active LangGraph operational agent state matrix.
        
    Returns:
        dict: State mutations and tracking telemetry to be merged into the graph.
    """

    results = []
    supplemental_messages = []
    state_updates = {}
    
    for tool_call in state["messages"][-1].tool_calls:
        target_tool = tools_by_name[tool_call["name"]]
        
        if tool_call["name"] == "test_rule":
            args = tool_call.get("args", {})
            json_string = args.get("json_string")
            url = args.get("url")
            
            if json_string is None or url is None:
                tool_observation = json.dumps({
                    "handled": False,
                    "error": "CRITICAL ERROR: You forgot the required 'json_string' or 'url' argument in your tool call. Please try again and provide both"
                })
            else:
                if isinstance(json_string, dict):
                    tool_call["args"]["json_string"] = json.dumps(json_string)
                tool_observation = target_tool.invoke(tool_call["args"])
        else:
            tool_observation = target_tool.invoke(tool_call["args"])
        
        if tool_call["name"] == "test_rule":
            state_updates["test_rule_count"] = state.get("test_rule_count", 0) + 1
            
            
            #only overwrite current_rule_draft if a json_string was actually provided
            submitted_json_string = tool_call["args"].get("json_string")
            if submitted_json_string is not None:
                state_updates["current_rule_draft"] = submitted_json_string
            
            try:
                parsed_test_results = json.loads(tool_observation)
                actual_error = parsed_test_results.get("error") or ""
                
                if (parsed_test_results.get("auditScreenshot")):
                    print("Audit screenshot found! Invoking Vision Model...")
                    
                    vision_result = call_vision(parsed_test_results["auditScreenshot"])
                    print(f"Vision result: {vision_result}")
                
                    state_updates["screenshot_info"] = vision_result
                
                    banner_still_visible_heuristic = parsed_test_results.get("bannerStatus", {}).get("audit", {}).get("heuristicBannerFound")
                        
                    if actual_error or banner_still_visible_heuristic == True:
                        supplemental_messages.append(HumanMessage(
                            content=f"Visual audit after test: {json.dumps(vision_result)}"
                        ))
                    
                elif "No CMP detected" in actual_error:
                    supplemental_messages.append(HumanMessage(
                        content=(
                            "DETECTOR FAILURE: 'No CMP detected' means your "
                            "presentMatcher or showingMatcher selector did NOT match "
                            "the banner. Fix your detector selectors FIRST, then test again."
                        )
                    ))
                
                if actual_error:
                    state_updates["error_history"] = [actual_error]
                    state_updates["last_error"] = actual_error
                
                parsed_test_results.pop("auditScreenshot", None)
                tool_observation = json.dumps(parsed_test_results)
                state_updates["last_test_result"] = parsed_test_results
                    
            except json.JSONDecodeError:
                actual_error = f"test_rule tool returned invalid JSON: {tool_observation[:100]}"
                state_updates["error_history"] = [actual_error]
                state_updates["last_error"] = actual_error
            
        elif tool_call["name"] == "analyze_screenshot":
            state_updates["analyze_screenshot_count"] = state.get("analyze_screenshot_count", 0) + 1
            try:
                parsed_analysis = json.loads(tool_observation)
                state_updates["screenshot_info"] = parsed_analysis
                
                if parsed_analysis.get("error"):
                    state_updates["error_history"] = [parsed_analysis["error"]]
                    state_updates["last_error"] = parsed_analysis["error"]
            except json.JSONDecodeError:
                actual_error = f"Screenshot tool returned invalid JSON: {tool_observation[:100]}"
                state_updates["error_history"] = [actual_error]
                state_updates["last_error"] = actual_error
        
        results.append(ToolMessage(content=tool_observation, tool_call_id=tool_call["id"]))
            
    combined_messages = results + supplemental_messages
    return {"messages": combined_messages, **state_updates}

llm_node = make_llm_node(model_with_tools)

workflow = StateGraph(AgentState)

workflow.add_node("extraction_node", extraction_node)
workflow.add_node("llm_node", llm_node)
workflow.add_node("tool_node", tool_node)
workflow.add_node("human_review_node", human_review_node)
workflow.add_node("rule_output_node", rule_output_node)

workflow.add_edge(START, "extraction_node")
workflow.add_edge("extraction_node", "llm_node")

workflow.add_conditional_edges(
    "llm_node",
    route_after_llm,
    ["tool_node", "human_review_node", "rule_output_node"]
)

workflow.add_edge("tool_node", "llm_node")
workflow.add_edge("human_review_node", "llm_node")

workflow.add_conditional_edges(
    "rule_output_node",
    route_after_rule,
    ["llm_node", END]
)
