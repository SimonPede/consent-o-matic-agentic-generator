import json
from src.agent.llm import llm
from src.agent.state import AgentState
from src.agent.routing import route_after_llm
from src.agent.routing import route_after_ruleset
from src.tools.analyse_screenshot import analyse_screenshot
from src.tools.test_ruleset import test_ruleset
from src.tools.request_human_review import request_human_review
from src.utils import call_ollama_vision
from langchain_core.messages import HumanMessage
from langgraph.graph import StateGraph, START, END

from src.agent.nodes import make_llm_node, extraction_node, human_review_node, ruleset_output_node

tools = [test_ruleset, request_human_review, analyse_screenshot]
tools_by_name = {tool.name: tool for tool in tools}
model_with_tools = llm.bind_tools(tools)

# tool_node = ToolNode(tools)
#Code from the docs for the tool node:
from langchain.messages import ToolMessage
def tool_node(state: dict):
    """Performs the tool call"""

    result = []
    state_updates = {}
    
    for tool_call in state["messages"][-1].tool_calls:
        tool = tools_by_name[tool_call["name"]]
        observation = tool.invoke(tool_call["args"])

        result.append(ToolMessage(content = observation, tool_call_id=tool_call["id"]))
        
        if tool_call["name"] == "test_ruleset":
            state_updates["current_ruleset_draft"] = tool_call["args"].get("json_string")
            
            try:
                parsed = json.loads(observation)
                
                if parsed.get("auditScreenshot"):
                    print("Test failed but audit screenshot found! Invoking Ollama Vision...")
                    
                    vision_result = call_ollama_vision(parsed["auditScreenshot"])
                    print(f"Vision result: {vision_result}")
                    
                    state_updates["screenshot_info"] = vision_result
                    state_updates["messages"] = [HumanMessage(
                        content = f"Visual audit after test: {json.dumps(vision_result)}"
                    )]
                    
                if parsed.get("error"):
                    state_updates["last_error"] = parsed["error"]
                    
            except json.JSONDecodeError:
                state_updates["last_error"] = f"test_ruleset tool returned invalid JSON: {observation[:100]}"
            
        elif tool_call["name"] == "analyse_screenshot":
            try:
                parsed = json.loads(observation)
                state_updates["screenshot_info"] = parsed
                
                if parsed.get("error"):
                    state_updates["last_error"] = parsed["error"]
            except json.JSONDecodeError:
                state_updates["last_error"] = f"Screenshot tool returned invalid JSON: {observation[:100]}"
            
    return {"messages": result, **state_updates}

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
    
#validate_json removed from tool list
#
# Original plan: validate_json as lightweight pre-check before test_ruleset.
# Planned checks:
#   1. Syntactic: Is the JSON valid? Are required fields present?
#   2. Semantic: Do the selectors exist in the extracted DOM?
#
# Why semantic check was dropped first:
#   The LLM is explicitly instructed to MODIFY selectors – adding textFilter,
#   using parent/target structure, stripping >>> Shadow DOM syntax.
#   An exact selector match against structured_dom_info would produce false
#   negatives for valid, intentionally modified selectors.
#
# Why syntactic check was dropped second:
#   test_ruleset uses CoMRuleset as args_schema (Pydantic). This means
#   LangGraph validates the LLM's tool call BEFORE test_ruleset executes.
#   Pydantic already checks:
#     - Valid JSON structure
#     - Required fields present (detector, methods)
#     - Correct types
#   validate_json would duplicate this check with no additional value.
#
# When to reconsider:
#   If evaluation shows the LLM makes too many failed test_ruleset calls
#   (high browser-start overhead), validate_json can be reintroduced as
#   a cheap pre-filter. At that point, focus only on structural checks
#   that Pydantic does NOT cover (e.g. empty methods list, unknown
#   method names like "DO_CONSENTT" typos).
#
# Current tool list: [analyse_screenshot, test_ruleset]
# validate_json: removed until evaluation justifies reintroduction.