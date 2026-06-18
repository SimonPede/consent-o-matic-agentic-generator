import subprocess
import json
import logging
import os
import re

from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
from langgraph.types import interrupt

from src.agent.state import AgentState
from src.prompts.system_prompt import get_system_prompt

logger = logging.getLogger(__name__)


def extraction_node(state: AgentState) -> dict:
    """Executes the external headless browser automation sequence via a Node.js subprocess.
    
    Extracts structured DOM fields and raw, filtered HTML from the live website target,
    parsing the dataset into the active execution context stream.
    """
    url = state.get("url", "")
    
    extract_dom_path = os.path.join(
        os.path.dirname(__file__), "..", "tools", "extract-dom", "main.js"
    )
    result = subprocess.run(
        ["node", extract_dom_path, url],
        capture_output=True,
        text=True
    )

    if result.returncode != 0:
        print("extraction_node, extract_tool returned 1:", result.stderr)
        return {
            "last_error": result.stderr
        }

    logger.debug("STDOUT: %s", result.stdout[:500])
    logger.debug("STDERR: %s", result.stderr[:200])
    
    output = json.loads(result.stdout)
    
    if output:
        output_str = json.dumps(output)
        output_length = len(output_str)
        print(f"DOM Extraction Matrix generated: {output_length} characters fetched.")
        
        settings_extracted_flag = False
        cmp_type_value = ""
        
        if isinstance(output, list):
            for frame_data in output:
                if frame_data.get("settings") is not None:
                    settings_extracted_flag = True
                
                if frame_data.get("cmpType") is not None:
                    cmp_type_value = frame_data.get("cmpType")
        
        return {
            #Rationale Note for Thesis: A ToolMessage requires an active, intercepted tool_call_id. 
            #Injecting the extracted layout environment via a HumanMessage acts as a clean 
            #and deterministic context-inflation mechanism for the LLM prompt buffer.
            "messages": [HumanMessage(content=f"Here is the DOM info, extracted by the extract tool: {output}")],
            "structured_dom_info": output,
            "structured_dom_chars": output_length,
            "cmp_type": cmp_type_value,
            "settings_extracted": settings_extracted_flag
        }
    else:
        return {
            "last_error": "extraction_node: extract_dom.js returned empty result",
            "messages": [
                HumanMessage(content=(
                    "DOM extraction returned no results. The page may not have a cookie banner or the script was detected and blocked"
                ))
            ]
        }

def make_llm_node(model_with_tools):
    """Factory closure that wraps the core LLM inference loop with injected tools."""
    def llm_node(state: AgentState):
        try:
            system_prompt = SystemMessage(content=get_system_prompt())
            response = model_with_tools.invoke(
                [system_prompt] + state["messages"]
            )
            
            if isinstance(response.content, list):
                for block in response.content:
                    if isinstance(block, dict) and block.get("type") == "text":
                        print("LLM Response:", block.get("text", ""))
            else:
                print("LLM Response:", response.content)
    
            return {
                "messages": [response],
                "attempts": state.get("attempts", 0) + 1
            }
        except Exception as e:
            print(f"LLM ERROR: {e}")
            raise
        
    return llm_node

def human_review_node(state: AgentState) -> dict:
    """Halts graph execution and prompts an operator via state interrupts to provide human feedback to the agent."""
    last_ai_message = None
    for message in reversed(state["messages"]):
        if not isinstance(message, ToolMessage):
            last_ai_message = message
            break
    
    attempts = state.get("attempts", 0)
    llm_choice = True
    
    if attempts >= 20:
        llm_choice = False
        
    question = ""
    if not llm_choice:
        question = "The Agent seems to be stuck, this call was not chosen by the LLM. It already needed 20 attempts and needs help. Please give Feedback:"
    else:
        question = "The Agent seems to be stuck and needs help. Please give Feedback:"
        
    context = {
        "question": question,
        "url": state.get("url"),
        "attempts": attempts,
        "last_ai_message": str(last_ai_message.content) if last_ai_message else "None",
        "last_error": state.get("last_error", "No error stored!"),
        "ruleset_draft": state.get("current_ruleset_draft"),
        "current_ruleset": state.get("final_result", "No ruleset generated yet.")
    }
    
    print("\n" + "-" * 40)
    print("HUMAN REVIEW REQUIRED")
    print("="*20)
    print(f"Question:              {context['question']}")
    print(f"URL:              {context['url']}")
    print(f"Tries:         {context['attempts']}")
    print(f"Last error:   {context['last_error']}")
    print(f"\nRuleset draft:   {context['ruleset_draft']}")
    print(f"\nLast LLM Message:   {context['last_ai_message']}")
    print("-" * 40)
    
    human_input = interrupt(context)
    
    return {
        "messages": [HumanMessage(content=f"Human feedback: {human_input}")],
        "human_review_count": state.get("human_review_count", 0) + 1
    }

def ruleset_output_node(state: AgentState) -> dict:
    """
    Extracts the final ruleset from markdown enclosures in the latest AI message.
    
    Some LLMs (e.g. Kimi with thinking mode) return content as a list
    of blocks like [{"type": "thinking", ...}, {"type": "text", ...}].
    Others return a plain string. Both cases are handled here.
    """ 
    #We only check the very last message, preventing infinite historical loops
    last_message = state["messages"][-1]
    content = last_message.content
    
    if isinstance(content, list):
        text_parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                text_parts.append(block.get("text", ""))
        content = " ".join(text_parts)
    else:
        content = str(content)

    #Reason for usage of "re.DOTALL": "." in regex then also matches with line breaks
    match = re.search(r"<ruleset>(.*?)</ruleset>", content, re.DOTALL)
    
    if match:
        try:
            #NOTE: match.group(1) returns the content of the first capture group (inside the tags)
            ruleset = json.loads(match.group(1).strip())
            return {"final_result": ruleset}
        except json.JSONDecodeError as error:
            error_message = f"Invalid JSON in ruleset tags: {str(error)}"
            print(f"--------- JSON ERROR: {error_message} ---------")
            
            return {
                "last_error": error_message,
                "messages": [
                    HumanMessage(content=(
                        "Your previous response contained <ruleset> tags, but the JSON inside was invalid.\n "
                        f"The Python JSON parser threw this exact error: '{str(error)}'\n"
                        "Please output the ruleset again with valid JSON inside <ruleset></ruleset> tags."
                    ))
                ]
            }
            
    print("--------- NO RULESET FOUND ---------")
    return {
        "last_error": "No ruleset found in agent message",
        "messages": [
            HumanMessage(content=(
                "Your previous response did not contain a ruleset wrapped in <ruleset></ruleset> tags. "
                "If you have drafted a ruleset based on your analysis, you MUST call the 'test_ruleset' tool to test it on the live DOM first! "
                "Do NOT output <ruleset> tags until the tool returns 'handled': true."
            ))
        ]
    }