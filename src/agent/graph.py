from src.agent.llm import llm
from src.agent.state import AgentState
from src.agent.routing import route_after_llm
from src.tools.analyse_screenshot import analyse_screenshot
from src.tools.test_ruleset import test_ruleset
from src.tools.request_human_review import request_human_review
from langgraph.graph import StateGraph, START, END
from langgraph.prebuilt import ToolNode

from src.agent.nodes import make_llm_node, extraction_node, human_review_node, ruleset_output_node

tools = [analyse_screenshot, test_ruleset, request_human_review]
# tools_by_name = {tool.name: tool for tool in tools}
model_with_tools = llm.bind_tools(tools)

tool_node = ToolNode(tools)
#Code from the docs for the tool node:
# from langchain.messages import ToolMessage
# def tool_node(state: dict):
#     """Performs the tool call"""

#     result = []
#     for tool_call in state["messages"][-1].tool_calls:
#         tool = tools_by_name[tool_call["name"]]
#         observation = tool.invoke(tool_call["args"])
#         result.append(ToolMessage(content=observation, tool_call_id=tool_call["id"]))
#     return {"messages": result}

llm_node = make_llm_node(model_with_tools)

workflow = StateGraph(AgentState)

workflow.add_node("extraction_node", extraction_node)
workflow.add_node("llm_node", llm_node)
workflow.add_node("tool_node", tool_node)
workflow.add_node("human_review_node", human_review_node)
workflow.add_node("ruleset_output_node", ruleset_output_node)

# Add edges to connect nodes
workflow.add_edge(START, "extraction_node")
workflow.add_edge("extraction_node", "llm_node")

workflow.add_conditional_edges(
    "llm_node",
    route_after_llm,
    ["tool_node", "human_review_node", "ruleset_output_node"]
)
workflow.add_edge("tool_node", "llm_node")
workflow.add_edge("human_review_node", "llm_node")

workflow.add_edge("ruleset_output_node", END)
    
# ARCHITECTURAL DECISION: validate_json removed from tool list
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

# def extract_all_selectors(structured_dom_info: list) -> set:
#     #the base ide: iterate over all entries of the outputed dom
#     # and collect all selectors in a set
#     selectors = set()
    
#     for frame in structured_dom_info:
#         data = frame.get("data", {})
        
#         for el_type in ["buttons", "checkboxes", "toggles"]:
#             for element in data.get(el_type, []):
#                 selector = element.get("selector")
#                 if selector:
#                     selectors.add(selector)
#                 data = frame.get("data", {})
        
#         data = frame.get("settings", {})
#         for el_type in ["buttons", "checkboxes", "toggles"]:
#             for element in data.get(el_type, []):
#                 selector = element.get("selector")
#                 if selector:
#                     selectors.add(selector)
#     return selectors

# def make_validate_json_tool(structured_dom_info: list):
#     #make a comment for your future self why you use closures!!
# dom_selectors = extract_all_selectors(structured_dom_info)
#     @tool
#     def validate_json(json_string: str) -> str:
        # """Lightweight pre-check: verifies that the generated ruleset is valid JSON 
        # and contains the required top-level fields 'deabetector' and 'methods'."""
        
        # try:
        #     parsed = json.loads(json_string)
        # except json.JSONDecodeError as e:
        #     return f"INVALID: JSON syntax error: {str(e)}"
        
        # missing = [field for field in ["detector", "methods"] if field not in parsed]
        # if missing:
        #     return f"INVALID: Missing required fields: {missing}"
        
        # if not isinstance(parsed["methods"], list) or len(parsed["methods"]) == 0:
        #     return "INVALID: 'methods' must be a non-empty list"
        
        # return "VALID: JSON structure looks correct."
#     return validate_json