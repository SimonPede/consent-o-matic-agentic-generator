import json

from langchain_core.messages import HumanMessage, ToolMessage
from langgraph.graph import StateGraph, START, END

from src.agent.llm import llm
from src.agent.nodes import (
    extraction_node,
    human_review_node,
    make_llm_node,
    ruleset_output_node,
)

from src.agent.state import AgentState
from src.agent.routing import route_after_llm, route_after_ruleset
from src.tools.analyse_screenshot import analyse_screenshot
from src.tools.test_ruleset import test_ruleset
from src.tools.request_human_review import request_human_review
from src.utils import call_vision

tools = [test_ruleset, request_human_review, analyse_screenshot]
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
    state_updates = {}
    
    for tool_call in state["messages"][-1].tool_calls:
        target_tool = tools_by_name[tool_call["name"]]
        
        if tool_call["name"] == "test_ruleset":
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

        results.append(ToolMessage(content=tool_observation, tool_call_id=tool_call["id"]))
        
        if tool_call["name"] == "test_ruleset":
            state_updates["test_ruleset_count"] = state.get("test_ruleset_count", 0) + 1
            state_updates["current_ruleset_draft"] = tool_call["args"].get("json_string")
            
            try:
                parsed_test_results = json.loads(tool_observation)
                actual_error = parsed_test_results.get("error") or ""
                
                if parsed_test_results.get("auditScreenshot"):
                    print("Test failed but audit screenshot found! Invoking Ollama Vision...")
                    
                    vision_result = call_vision(parsed_test_results["auditScreenshot"])
                    print(f"Vision result: {vision_result}")
                    
                    state_updates["screenshot_info"] = vision_result
                    state_updates["messages"] = [HumanMessage(
                        content = f"Visual audit after test: {json.dumps(vision_result)}"
                    )]
                    
                elif "No CMP detected" in actual_error:
                    state_updates["messages"] = [HumanMessage(
                        content=(
                            "DETECTOR FAILURE: 'No CMP detected' means your "
                            "presentMatcher or showingMatcher selector did NOT match "
                            "the banner. Fix your detector selectors FIRST, then test again."
                        )
                    )]
                
                if actual_error:
                    state_updates["error_history"] = [actual_error]
                    state_updates["last_error"] = actual_error
                
                parsed_test_results.pop("auditScreenshot", None)
                state_updates["last_test_result"] = parsed_test_results
                    
            except json.JSONDecodeError:
                state_updates["last_error"] = f"test_ruleset tool returned invalid JSON: {tool_observation[:100]}"
            
        elif tool_call["name"] == "analyse_screenshot":
            state_updates["analyse_screenshot_count"] = state.get("analyse_screenshot_count", 0) + 1
            try:
                parsed_analysis = json.loads(tool_observation)
                state_updates["screenshot_info"] = parsed_analysis
                
                if parsed_analysis.get("error"):
                    state_updates["last_error"] = parsed_analysis["error"]
            except json.JSONDecodeError:
                state_updates["last_error"] = f"Screenshot tool returned invalid JSON: {tool_observation[:100]}"
            
    return {"messages": results, **state_updates}

llm_node = make_llm_node(model_with_tools)

workflow = StateGraph(AgentState)

workflow.add_node("extraction_node", extraction_node)
workflow.add_node("llm_node", llm_node)
workflow.add_node("tool_node", tool_node)
workflow.add_node("human_review_node", human_review_node)
workflow.add_node("ruleset_output_node", ruleset_output_node)

workflow.add_edge(START, "extraction_node")
workflow.add_edge("extraction_node", "llm_node")

workflow.add_conditional_edges(
    "llm_node",
    route_after_llm,
    ["tool_node", "human_review_node", "ruleset_output_node"]
)

workflow.add_edge("tool_node", "llm_node")
workflow.add_edge("human_review_node", "llm_node")

workflow.add_conditional_edges(
    "ruleset_output_node",
    route_after_ruleset,
    ["llm_node", END]
)