import subprocess
import json
import logging
from datetime import datetime
import os
import re
import time

from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
from langgraph.types import interrupt

from src.agent.state import AgentState
from src.prompts.system_prompt import get_system_prompt

logger = logging.getLogger(__name__)


def _extract_dom_error_from_stderr(stderr_text: str) -> str:
    """Extracts the most useful extract-dom failure line from stderr output."""
    if not stderr_text:
        return ""

    stderr_lines = [line.strip() for line in stderr_text.splitlines() if line.strip()]

    for line in stderr_lines:
        if "extractStructuredDom critical execution failure" in line:
            return line

    return stderr_lines[-1] if stderr_lines else ""

def write_extract_dom_log(url: str, command: list[str], result: subprocess.CompletedProcess, duration_seconds: float, parsed_output=None, parse_error: str | None = None) -> None:
    """Writes a structured extract-dom execution log to data/logs/extract-dom/."""
    try:
        log_dir = os.path.join("data", "logs", "extract-dom")
        os.makedirs(log_dir, exist_ok=True)

        clean_url = (url or "unknown").replace("https://", "").replace("http://", "").rstrip("/").replace("/", "_")
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        log_path = os.path.join(log_dir, f"{timestamp}_{clean_url}.json")

        stderr_lines = [line for line in result.stderr.splitlines() if line.strip()]

        log_payload = {
            "timestamp": datetime.now().isoformat(),
            "url": url,
            "command": command,
            "duration_seconds": round(duration_seconds, 3),
            "returncode": result.returncode,
            "stderr": {
                "lines": stderr_lines,
            },
            "stdout_json_parse_error": parse_error,
            "stdout_json": parsed_output,
        }

        with open(log_path, "w", encoding="utf-8") as file_handle:
            json.dump(log_payload, file_handle, indent=2, ensure_ascii=False)

        print(f"extract-dom JSON log written: {log_path}")
    except Exception as log_error:
        print(f"Failed to write extract-dom JSON log: {log_error}")


def extraction_node(state: AgentState) -> dict:
    """Executes the external headless browser automation sequence via a Node.js subprocess.
    
    Extracts structured DOM fields and raw, filtered HTML from the live website target,
    parsing the dataset into the active execution context stream.
    """
    url = state.get("url", "")
    
    extract_dom_path = os.path.join(
        os.path.dirname(__file__), "..", "tools", "extract-dom", "main.js"
    )
    extract_cmd = ["node", extract_dom_path, url]
    extract_timeout_seconds = 450
    extract_start_time = time.perf_counter()
    try:
        result = subprocess.run(
            extract_cmd,
            capture_output=True,
            text=True,
            timeout=extract_timeout_seconds,
        )
    except subprocess.TimeoutExpired as timeout_error:
        extract_duration_seconds = round(time.perf_counter() - extract_start_time, 2)
        timeout_stderr = (
            f"extract_dom.js timed out after {extract_timeout_seconds}s for URL: {url}"
        )

        timeout_result = subprocess.CompletedProcess(
            args=extract_cmd,
            returncode=124,
            stdout=(timeout_error.stdout or "") if isinstance(timeout_error.stdout, str) else "",
            stderr=timeout_stderr,
        )

        write_extract_dom_log(
            url=url,
            command=extract_cmd,
            result=timeout_result,
            duration_seconds=extract_duration_seconds,
            parsed_output=None,
            parse_error=timeout_stderr,
        )

        print(timeout_stderr)
        return {
            "last_error": timeout_stderr,
            "extraction_duration_seconds": extract_duration_seconds,
        }

    extract_duration_seconds = round(time.perf_counter() - extract_start_time, 2)

    output = None
    parse_error = None
    if result.stdout and result.stdout.strip():
        try:
            output = json.loads(result.stdout)
        except json.JSONDecodeError as error:
            parse_error = str(error)

    write_extract_dom_log(
        url=url,
        command=extract_cmd,
        result=result,
        duration_seconds=extract_duration_seconds,
        parsed_output=output,
        parse_error=parse_error,
    )

    print(f"extract-dom runtime: {extract_duration_seconds:.2f}s")

    if result.stderr:
        print("\n[extract-dom logs]")
        print(result.stderr, end="" if result.stderr.endswith("\n") else "\n")

    if result.returncode != 0:
        print("extraction_node, extract_tool returned 1:", result.stderr)
        concise_error = _extract_dom_error_from_stderr(result.stderr)
        return {
            "last_error": concise_error or result.stderr,
            "extraction_duration_seconds": extract_duration_seconds,
        }

    if parse_error:
        return {
            "last_error": f"extraction_node: extract_dom.js returned invalid JSON: {parse_error}",
            "extraction_duration_seconds": extract_duration_seconds,
            "messages": [
                HumanMessage(content=(
                    "DOM extraction returned invalid JSON output. "
                    "Please inspect the extract-dom JSON log in data/logs/extract-dom/."
                ))
            ]
        }

    logger.debug("STDOUT: %s", result.stdout[:500])
    logger.debug("STDERR: %s", result.stderr[:200])
    
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
            #ToolMessage requires a valid, active tool_call_id.
            #At this stage, extraction output is therefore injected via HumanMessage.
            "messages": [HumanMessage(content=f"Here is the DOM info, extracted by the extract tool: {output}")],
            "structured_dom_info": output,
            "structured_dom_chars": output_length,
            "cmp_type": cmp_type_value,
            "settings_extracted": settings_extracted_flag,
            "extraction_duration_seconds": extract_duration_seconds,
        }
    else:
        stderr_error = _extract_dom_error_from_stderr(result.stderr)
        empty_result_error = "extraction_node: extract_dom.js returned empty result"
        if stderr_error:
            empty_result_error = f"{empty_result_error} | {stderr_error}"

        return {
            "last_error": empty_result_error,
            "extraction_duration_seconds": extract_duration_seconds,
            "messages": [
                HumanMessage(content=(
                    "DOM extraction returned no results. The page may not have a cookie banner or the script was detected and blocked"
                ))
            ]
        }

def make_llm_node(model_with_tools):
    """Returns an LLM node closure bound to the configured tool-enabled model."""
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
                
            #Field name differs by backend: LiteLLM uses "finish_reason", Ollama uses "done_reason".
            metadata = response.response_metadata
            finish_reason = metadata.get("finish_reason")
            done_reason = metadata.get("done_reason")
            
            is_truncated = (finish_reason == "length") or (
                done_reason is not None and done_reason != "stop"
            )
            
            if is_truncated:
                print(f"WARNING: LLM response was truncated")
                
                return {
                    "messages": [HumanMessage(content=(
                        "Your previous response was cut off because it "
                        "exceeded the maximum output length. Please provide "
                        "a more concise analysis, or continue directly with "
                        "your next action, without repeating what you "
                        "already covered."
                    ))],
                    "llm_calls": state.get("llm_calls", 0) + 1
                }
    
            return {
                "messages": [response],
                "llm_calls": state.get("llm_calls", 0) + 1
            }
        except Exception as e:
            print(f"LLM ERROR: {e}")
            raise
        
    return llm_node

def human_review_node(state: AgentState) -> dict:
    """Pauses execution and requests operator feedback via LangGraph interrupt."""
    last_ai_message = None
    for message in reversed(state["messages"]):
        if not isinstance(message, ToolMessage):
            last_ai_message = message
            break
    
    llm_calls = state.get("llm_calls", 0)
    llm_choice = True
    
    max_llm_calls_budget = 20 + (state.get("human_review_count", 0) * 5)
    
    if llm_calls >= max_llm_calls_budget:
        llm_choice = False
        
    question = ""
    if not llm_choice:
        question = "The Agent seems to be stuck, this call was not chosen by the LLM. Please give Feedback:"
    else:
        question = "The Agent asks for help. Please give Feedback:"
        
    current_rule_draft = state.get("current_rule_draft")
    
    if current_rule_draft:
        try:
            current_rule_draft = json.loads(current_rule_draft)
        except (json.JSONDecodeError, TypeError):
            current_rule_draft = "Invalid or unparseable JSON draft."
    else:
        current_rule_draft = "No rule could be found!"
    
    context = {
        "question": question,
        "url": state.get("url", "No url provided!"),
        "llm_calls": llm_calls,
        "last_ai_message": str(last_ai_message.content) if last_ai_message else "None",
        "last_error": state.get("last_error", "No error stored!"),
        "rule_draft": current_rule_draft
    }
    
    log_dir = "data/logs/human-reviews"
    os.makedirs(log_dir, exist_ok=True)
    
    clean_url = context["url"].replace("https://", "").replace("http://", "").rstrip("/").replace("/", "_")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{timestamp}_{clean_url}.json"
    filepath = os.path.join(log_dir, filename)
    
    try:
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(context, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Failed to log human review context {e}")
    
    print("\n" + "-" * 40)
    print("HUMAN REVIEW REQUIRED")
    print("="*20)
    print(f"Question:              {context['question']}")
    print(f"URL:                   {context['url']}")
    print(f"Tries:                 {context['llm_calls']}")
    print(f"Last error:            {context['last_error']}")
    print(f"\nRuleset draft:       {json.dumps(context['rule_draft'], indent=2, ensure_ascii=False)}")
    print(f"\nLast LLM Message:    {context['last_ai_message']}")
    print("-" * 40)
    
    human_input = interrupt(context)
    
    return {
        "messages": [HumanMessage(content=f"Human feedback: {human_input}")],
        "human_review_count": state.get("human_review_count", 0) + 1
    }

def rule_output_node(state: AgentState) -> dict:
    """
    Extracts the final rule from markdown enclosures in the latest AI message.
    
    Some LLMs (e.g. Kimi with thinking mode) return content as a list
    of blocks like [{"type": "thinking", ...}, {"type": "text", ...}].
    Others return a plain string. Both cases are handled here.
    """ 
    #Only inspect the most recent message to avoid historical-loop effects.
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

    #`re.DOTALL` allows `.` to match line breaks inside <rule>...</rule>.
    match = re.search(r"<rule>(.*?)</rule>", content, re.DOTALL)
    
    if match:
        try:
            #`match.group(1)` returns the first capture group (content inside tags).
            rule = json.loads(match.group(1).strip())
            return {"final_result": rule}
        except json.JSONDecodeError as error:
            error_message = f"Invalid JSON in rule tags: {str(error)}"
            print(f"--------- JSON ERROR: {error_message} ---------")
            
            return {
                "last_error": error_message,
                "messages": [
                    HumanMessage(content=(
                        "Your previous response contained <rule> tags, but the JSON inside was invalid.\n "
                        f"The Python JSON parser threw this exact error: '{str(error)}'\n"
                        "Please output the rule again with valid JSON inside <rule></rule> tags."
                    ))
                ]
            }
            
    print("--------- NO RULESET FOUND ---------")
    return {
        "last_error": "No rule found in agent message",
        "messages": [
            HumanMessage(content=(
                "Your previous response did not contain a rule wrapped in <rule></rule> tags. "
                "If you have drafted a rule based on your analysis, you MUST call the 'test_rule' tool to test it on the live DOM first! "
                "Do NOT output <rule> tags until the tool returns 'handled': true."
            ))
        ]
    }
