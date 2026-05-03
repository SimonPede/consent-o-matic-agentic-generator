import subprocess
import json
import os
import re
from typing import Literal

import logging
logger = logging.getLogger(__name__)

from langgraph.types import interrupt
from src.agent.state import AgentState
from langchain_core.messages import HumanMessage, AIMessage
from langgraph.types import interrupt

from src.prompts.system_prompt import get_system_prompt

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

def make_llm_node(model_with_tools):
	def llm_node(state: AgentState):
		""""""
		# system_prompt = SystemMessage(content = get_system_prompt())
		# return {
		#     "messages": [
		#         model_with_tools.invoke(
		#             [system_prompt] + state["messages"]
		#         )
		#     ],
		#     "attempts": state.get("attempts", 0) + 1
		# }
		return {
			"messages": [AIMessage(content = "TEMP: LLM not callable")],
			"attempts": state.get("attempts", 0) + 1
		}
	return llm_node

def human_review_node(state: AgentState) -> object:
    
    last_message = state["messages"][-1]
    
    attempts = state.get("attempts", 0)
    llm_choice = True
    
    if attempts >= 20:
        llm_choice = False
        
    question = ""
    if llm_choice == False:
        question = "The Agent seems to be stuck, this call was not choicen by the LLM. It already needed 20 attempts and needs help. Please give Feedback:"
    else:
        question = "The Agent seems to be stuck and needs help. Please give Feedback:"
        
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
    
    human_input = interrupt(context)
    
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