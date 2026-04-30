from dotenv import load_dotenv
import subprocess
import json
import os
import re

import logging
logger = logging.getLogger(__name__)

from typing import Literal
from langchain_ollama import ChatOllama
from langchain_core.messages import AnyMessage, SystemMessage, HumanMessage, ToolMessage
from langchain_core.tools import tool
from langgraph.graph import StateGraph, START, END
from langgraph.prebuilt import ToolNode
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import interrupt

from src.agent.state import AgentState
from src.prompts.system_prompt import get_system_prompt
# from nodes import Nodes

llm = ChatOllama(
    model = "gemma4:31b",
    reasoning = True,
    temperature = 0,
    base_url = os.getenv("OLLAMA_BASE_URL"),
    client_kwargs={"headers": {"Authorization": f"Bearer {os.getenv('OLLAMA_API_KEY')}"}},
    validate_model_on_init = True,
    # other params...
    #https://reference.langchain.com/python/langchain-ollama/chat_models/ChatOllama?_gl=1*vdpck4*_gcl_au*MzczODM4NTUyLjE3NzMyMTk1MDM.*_ga*MzAyMjMwMzMzLjE3NzMyMTk1MDM.*_ga_47WX3HKKY2*czE3NzUzODkyNjYkbzIxJGcxJHQxNzc1MzkzOTM2JGo1NiRsMCRoMA..#member-format-18
)

#for implementing: o	bei frameScore bewertung: es so bauen, dass wenn der falsche Frame gefunden wird,
#es ja aber durch guten Score trotzdem dem LLM gegeben wird und das LLM sagt „the fuck. Ich kann hier nichts für die Regeln finden“,
# dann das System so bauen, dass es zurück in geht und dem LLM das DOM für den zweitbesten Frame extrahiert und so weiter. Wie?!
#i have to implemented extratc as a tool and a node, right?
# @tool
# def extract_dom_tool(url: str, state: AgentState) -> dict: #doesnt need the State, right?
#     """extract the DOM... detailed desicription with params etc for LLM"""

#     return {}
    
@tool
def analyse_screenshot(url: str) -> str:
    """
    Input: URL (String)
    Output: Structured JSON string with: banner visible (yes/no), banner position, found
        buttons with text and colour
    Purpose:
        Supplements DOM analysis with visual information. Particularly useful
        when the DOM is obfuscated or button texts are not present in the HTML.
        Answers: Is a banner visible? Which buttons are shown? Where are they
        positioned?
    """
    return ""

# @tool
# def request_human_review(state: AgentState) -> str:
#     return ""

@tool
def test_ruleset(url: str, json_string: str) -> str:
    """
    Input: URL (String)
    Output: Structured JSON string with: banner visible (yes/no), banner position, found
        buttons with text and colour
    Purpose:
        Supplements DOM analysis with visual information. Particularly useful
        when the DOM is obfuscated or button texts are not present in the HTML.
        Answers: Is a banner visible? Which buttons are shown? Where are they
        positioned?
    """
    return ""

@tool
def validate_json(json_string: str) -> str:
    """
    Input: JSON string (generated ruleset)
    Output: "valid" or "invalid (with error description)"
    Purpose:    
        Syntactic correctness and schema conformity are enforced by the
        Pydantic model (CoMRuleset) at the point of the test_ruleset tool call.
        validate_json serves as a lightweight pre-check, verifying semantic
        plausibility: do the generated selectors exist in the previously extracted
        DOM? Are there contradictions between the defined methods and the
        available DOM elements?
    """
    return ""
    

tools = [analyse_screenshot, test_ruleset, validate_json]
tools_by_name = {tool.name: tool for tool in tools}
model_with_tools = llm.bind_tools(tools)

def extraction_node(state: AgentState) -> dict: #doesnt need the State, right?
    """
    Input: URL (String)
    Output:
        Structured JSON object with: found buttons/sliders/toggles (text, selector,
        probable action, category), filtered HTML snippet as fallback (without
        style, scripts, img etc.), metadata (URL, detected CMP)
    Purpose:
        Extracts the relevant DOM section of the cookie banner using frame
        traversal and shadow DOM traversal via parent-target selection according
        to the CoM engine specification. First attempts to find known CMPs
        (OneTrust, Cookiebot, etc.) via specific selectors, falls back to generic
        heuristics (z-index, cookie keywords in classes/IDs), and uses the entire
        body as a last resort fallback.
    """

    url = state.get("url", "")
    
    #__file__ = .../src/agent/graph.py
    EXTRACT_DOM_PATH = os.path.join(
        os.path.dirname(__file__), "..", "tools", "extract_dom.js"
    )
    result = subprocess.run(
        ["node", EXTRACT_DOM_PATH, url],
        capture_output = True,
        text = True
    )

    if result.returncode != 0:
        print("extraction_node, extract_tool returned 1:", result.stderr)
        return {
            "last_error": result.stderr
        }
    
    # print("=== STDOUT ===")
    # print(repr(result.stdout[:500]))
    # print("=== STDERR ===")  
    # print(result.stderr[:200])
    logger.debug("STDOUT: %s", result.stdout[:500])
    logger.debug("STDERR: %s", result.stderr[:200])
    
    output = json.loads(result.stdout)
    
    if output:
        return {
            #why am i not using ToolMessage? because ToolMessage needs a tool_call_id! 
            #HumanMessage can be used to inject context
            "messages": [HumanMessage(content = f"Here is the DOM info, extracted by the extract tool: {output}")],
            "structured_dom_info": output,
            "cmp_typ": output[0].get("cmpType", "")
        }
    else:
        return {
            "last_error": "extraction_node: extract_dom.js returned empty result",
            "messages": [HumanMessage(content = "DOM extraction returned no results. The page may not have a cookie banner or the script detected and was blocked")]
        }


def llm_node(state: AgentState):
    """"""
    # system_prompt = SystemMessage(content = get_system_prompt())
    # return {
    #     "messages": [
    #         model_with_tools.invoke(
    #             [system_prompt] + state["messages"] #kombiniert die festen Verhaltensregeln (SystemMessage) mit dem aktuellen Gedächtnis des Agenten
    #         )
    #     ],
    #     "attempts": state.get("attempts", 0) + 1
    # }
    from langchain_core.messages import AIMessage
    return {
        "messages": [AIMessage(content="TEMP: LLM not callable")],
        "attempts": state.get("attempts", 0) + 1
    }

def route_after_llm(state: AgentState) -> Literal["tool_node", "human_review_node", "ruleset_output_node"]:
    
    if state.get("attempts", 0) >= 20:
        return "human_review_node"
    
    last_message = state["messages"][-1]
    
    if not last_message.tool_calls:
        return "ruleset_output_node"
    
    return "tool_node"

tool_node = ToolNode(tools)

def human_review_node(state: AgentState) -> object:
    
    last_message = state["messages"][-1]
    
    attempts = state.get("attempts", 0)
    llm_choice = True
    
    if attempts >= 20:
        llm_choice = False
        
    question = ""
    if llm_choice:
        question = "The Agent seems to be stuck, this call was not choicen by the LLM. It already needed 20 attempts and needs help. Please give Feedback:"
    else: question = "The Agent seems to be stuck and needs help. Please give Feedback:"
        
    context = {
        "question": question,
        "url": state.get("url"),
        "attempts": attempts,
        "last_message": str(last_message.content),
        "failed_selectors": state.get("failed_selectors", []),
        "last_error": state.get("last_error", "No error stored!"),
        "current_ruleset": state.get("final_result", "No ruleset generated yet.")
    }
    
    print("\n" + "=" * 40)
    print("HUMAN REVIEW REQUIRED")
    print("="*20)
    print(f"URL:              {context['url']}")
    print(f"Tries:         {context['attempts']}")
    print(f"Last error:   {context['last_error']}")
    print(f"Failed Selectors: {context['failed_selectors']}")
    print(f"\nRuleset draft:")
    print(json.dumps(context['current_ruleset'], indent = 2))
    print("=" * 40)
    
    human_input = interrupt({context})
    
    return {
        "messages": [HumanMessage(content = f"Human feedback: {human_input}")],
        "human_review_count": state.get("human_review_count", 0) + 1
    }

def ruleset_output_node(state: AgentState) -> dict:
    #later: extract final JSON from messages
    for message in reversed(state["messages"]):
        if getattr(message, "tool_calls", None): #to ensure it is not aborted (could happen when message.tool_calls is used)
            continue
        content = str(message.content)
        match = re.search(r"<ruleset>(.*?)</ruleset>", content, re.DOTALL)
        #why re.DOTALL: "." in regex then also matches with line breaks
        if match:
            try:
                ruleset = json.loads(match.group(1).strip())
                #why match.group(1): returns the content of the first breaks, whats between <ruleset> tags
                print("\n--------- FINALE RULESET ---------")
                print(json.dumps(ruleset, indent = 2))
                return {"final_result": ruleset}
            except json.JSONDecodeError:
                pass
    print("--------- NO RULESET FOUND ---------")
    return {"last_error": "No ruleset found in agent messages"}

#Code aus den docs:
# from langchain.messages import ToolMessage
# def tool_node(state: dict):
#     """Performs the tool call"""

#     result = []
#     for tool_call in state["messages"][-1].tool_calls:
#         tool = tools_by_name[tool_call["name"]]
#         observation = tool.invoke(tool_call["args"])
#         result.append(ToolMessage(content=observation, tool_call_id=tool_call["id"]))
#     return {"messages": result}

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

memory = MemorySaver()

agent = workflow.compile(checkpointer = memory)

#Show the agent
png_data = agent.get_graph(xray=True).draw_mermaid_png()

with open("graph.png", "wb") as f:
    f.write(png_data)