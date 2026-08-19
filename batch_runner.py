import sys
import time
import os
import multiprocessing as mp
import warnings
from datetime import datetime

from dotenv import load_dotenv
from langchain_core.messages import HumanMessage
#Utilizing a small db with help of SQLite ()
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.types import Command

#Import the uncompiled StateGraph blueprint from the agent module
from src.agent.graph import workflow

#Import for run logging
from src.utils.run_logger import log_run
from src.agent.llm import MODEL_NAME
from src.prompts.static_few_shot_examples import FEW_SHOT_CONFIG

load_dotenv()

warnings.filterwarnings("ignore", category=UserWarning, module="pydantic")

def detect_stuck_reason_from_state(state: dict) -> str:
    """Infers a likely no-progress root cause from the latest persisted run state."""
    test_result = state.get("last_test_result") or {}
    actual_error = (test_result.get("error") or state.get("last_error") or "").strip()
    if not actual_error:
        return ""

    clicks = test_result.get("clicks", 0)
    banner_status = test_result.get("bannerStatus", {})
    audit = banner_status.get("audit", {})
    baseline = banner_status.get("baseline", {})

    banner_still_visible = (
        audit.get("heuristicBannerFound") == True
        or audit.get("tcfVisible") == True
        or (baseline.get("tcfVisible") == True and audit.get("tcfHidden") == False)
    )

    if "ACTION_TARGET_NOT_FOUND" in actual_error and clicks == 0 and banner_still_visible:
        return "Likely repeated selector failure without progress (possible inaccessible iframe/shadow DOM or wrong execution context)."

    if "No CMP detected" in actual_error and clicks == 0:
        return "Likely repeated detector failure without progress (presentMatcher/showingMatcher did not match the live banner context)."

    if "matchers failed" in actual_error and banner_still_visible:
        return "Likely repeated matcher failure without progress (banner stayed visible while matchers kept failing)."

    return actual_error

def build_soft_timeout_prompt(state: dict, remaining_seconds: float) -> str:
    """Creates a final time-pressure prompt shortly before the hard timeout."""
    suspected_reason = detect_stuck_reason_from_state(state) or "Unknown no-progress cause."
    last_error = state.get("last_error", "")
    test_rule_count = state.get("test_rule_count", 0)

    return (
        "Soft TIMEOUT: less than approximately "
        f"{int(max(0, remaining_seconds))} seconds remain before forced termination. "
        "Do NOT spend time on another minor selector variation. "
        "Use your current_rule_draft, last_test_result, and prior observations to finalize now. "
        f"Latest known error: {last_error or 'none recorded'}. "
        f"Most likely root cause: {suspected_reason}, formulated in such detail a human reviewer can understand the most likely problem."
        f"You have already used test_rule {test_rule_count} times. "
        "If you are confident, output your final <rule>. "
        "If you are not confident, output a final <abort>...</abort> now and include the most likely root cause in the abort text. "
        "Your last rule draft and this suspected reason will be logged."
    )

def load_checkpoint_state(thread_id: str) -> dict:
    """Reads the latest persisted graph state for timeout/crash logging."""
    config = {"configurable": {"thread_id": thread_id}}
    with SqliteSaver.from_conn_string("checkpoints.db") as checkpointer:
        agent = workflow.compile(checkpointer=checkpointer)
        snapshot = agent.get_state(config)
        if snapshot and snapshot.values:
            return dict(snapshot.values)
    return {}

def load_urls_from_file(filepath: str) -> list:
    """Reads a .txt file with urls and returns a list with these urls
    
    Args:
        filepath: The path leading to the .txt file.
    """
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return [line.strip() for line in f if line.strip()]
    except FileNotFoundError:
        print(f"Error: {filepath} was not found!")
        return []

def run_single(agent, url: str, thread_id: str, timeout_seconds: int) -> None:
    """
    Executes a single evaluation run for the given URL and logs the result.

    Runs the agent in a loop to handle consecutive human review interrupts
    automatically. In batch mode, interrupts are resolved by instructing the
    LLM to finalize its output without human input. After max_auto_resumes
    consecutive interrupts, the run is aborted and logged as failed.

    Args:
        agent: The compiled LangGraph agent instance.
        url: The target website URL to generate a rule for.
    """
    print(f"Starting run for {url}")
    
    config = {"configurable": {"thread_id": thread_id}}

    inputs = {
        "messages": [HumanMessage(content=f"Generate a Consent-O-Matic rule for: {url}")],
        "url": url,
        "batch_mode": True,
        "structured_dom_chars": 0,
        "llm_calls": 0, #IMPORTANT: NOT the number of tries the LLM needed to generate a correct rule! For that metric "test_rule_count" is sufficient
        "model_aborted": False,
        "abort_reason": "",
        "suspected_stuck_reason": "",
        "human_review_count": 0,
        "last_error": "",
        "structured_dom_info": None,
        "extraction_duration_seconds": 0.0,
        "cmp_type": "",
        "settings_extracted": False,
        "screenshot_info": None,
        "current_rule_draft": "",
        "last_test_result": None,
        "error_history": [],
        "test_rule_count": 0,
        "analyze_screenshot_count": 0,
        "final_result": None,
    }
    
    start_time = time.perf_counter()
    
    current_input = inputs
    auto_resume_count = 0
    max_auto_resumes = 2
    soft_timeout_prompt_sent = False
    soft_timeout_seconds = max(0, timeout_seconds - 240)
    
    while auto_resume_count <= max_auto_resumes:
        interrupted = False
        
        try:
            for chunk in agent.stream(current_input, config=config):
                restart_with_soft_timeout_prompt = False
                for node_name, output in chunk.items():
                    if node_name == "__interrupt__":
                        interrupted = True
                        auto_resume_count += 1 
                        print(f"Human review required for {url} --> skipping.")
                        
                        prompt = (
                            "Batch evaluation mode active. No human is available to review or help. "
                            "You must think and try it one last time, then finalize your task immediately based on your knowledge. "
                            "Output your best guess for the <rule> to finish the graph."
                        )
                        current_input = Command(resume=prompt)
                    else:
                        print(f"\n[Node: {node_name}]")
                        
                elapsed = time.perf_counter() - start_time
                if not soft_timeout_prompt_sent and elapsed >= soft_timeout_seconds:
                    state_snapshot = dict(agent.get_state(config).values)
                    suspected_reason = detect_stuck_reason_from_state(state_snapshot)
                    if suspected_reason:
                        state_snapshot["suspected_stuck_reason"] = suspected_reason
                    remaining_seconds = max(0.0, timeout_seconds - elapsed)
                    print(f"Soft timeout window reached for {url}. Injecting finalization prompt.")
                    current_input = {
                        "messages": [HumanMessage(
                            content=build_soft_timeout_prompt(state_snapshot, remaining_seconds))
                        ]
                    }
                    soft_timeout_prompt_sent = True
                    restart_with_soft_timeout_prompt = True
                    interrupted = True
                    break

                if restart_with_soft_timeout_prompt:
                    break
        except Exception as e:
            print(f"\nERROR in run_single: {e}")
            duration = time.perf_counter() - start_time
            
            log_run(
                {"url": url, "batch_mode": True, "llm_calls": 0, "last_error": str(e),
                "final_result": None, "last_test_result": None,
                "human_review_count": 0, "cmp_type": "", "extraction_duration_seconds": 0.0,
                "model_aborted": False, "abort_reason": "", "suspected_stuck_reason": "", "current_rule_draft": ""},
                duration_seconds=duration,
                model_name=MODEL_NAME,
                few_shot_config=FEW_SHOT_CONFIG
            )
            return
        
        if not interrupted:
            print("\n Execution Pipeline Successfully Terminated")
            break
    
    if auto_resume_count > max_auto_resumes:
        print(f"Max auto-resumes reached for {url} --> aborting run.")
        duration = time.perf_counter() - start_time
        final_state = agent.get_state(config)

        state_values = dict(final_state.values)
        state_values["last_error"] = "ABORTED: max auto-resumes reached"
        state_values["suspected_stuck_reason"] = state_values.get("suspected_stuck_reason") or detect_stuck_reason_from_state(state_values)
        log_run(
            state_values,
            duration_seconds=duration,
            model_name=MODEL_NAME,
            few_shot_config=FEW_SHOT_CONFIG,
            aborted_max_resumes=True,
        )
        
        return

    print(f"\nSaving evaluation metadata for {url}...")
    duration = time.perf_counter() - start_time
    
    final_state = agent.get_state(config)
    final_state_values = dict(final_state.values)
    if soft_timeout_prompt_sent:
        final_state_values["suspected_stuck_reason"] = final_state_values.get("suspected_stuck_reason") or detect_stuck_reason_from_state(final_state_values)
    log_run(
        final_state_values,
        duration_seconds=duration,
        model_name=MODEL_NAME,
        few_shot_config=FEW_SHOT_CONFIG,
        aborted_max_resumes=False,
    )

def run_single_in_subprocess(url: str, thread_id: str, timeout_seconds: int) -> None:
    """
    Worker entrypoint for exactly one URL.
    Compiles its own agent/checkpointer inside the child process.
    """
    with SqliteSaver.from_conn_string("checkpoints.db") as checkpointer:
        agent = workflow.compile(checkpointer=checkpointer)
        run_single(agent, url, thread_id, timeout_seconds)

def run_single_with_timeout(url: str, timeout_seconds: int) -> None:
    """
    Runs a single URL in an isolated process with a hard overall timeout.

    If the timeout is hit, the worker process is terminated and a timeout run
    is logged so the batch can continue deterministically.
    """
    start_time = time.perf_counter()
    thread_timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    thread_id = f"{url}_{thread_timestamp}"

    process = mp.Process(target=run_single_in_subprocess, args=(url, thread_id, timeout_seconds))
    process.start()
    process.join(timeout=timeout_seconds)

    if process.is_alive():
        print(f"Overall timeout reached for {url} after {timeout_seconds}s --> terminating worker.")
        process.terminate()
        process.join(timeout=5)

        duration = time.perf_counter() - start_time
        recovered_state = load_checkpoint_state(thread_id)
        if recovered_state:
            recovered_state["last_error"] = f"ABORTED: overall timeout reached ({timeout_seconds}s)"
            recovered_state["aborted_timeout"] = True
            recovered_state["suspected_stuck_reason"] = recovered_state.get("suspected_stuck_reason") or detect_stuck_reason_from_state(recovered_state)
            timeout_state = recovered_state
        else:
            timeout_state = {
                "url": url,
                "batch_mode": True,
                "llm_calls": 0,
                "last_error": f"ABORTED: overall timeout reached ({timeout_seconds}s)",
                "final_result": None,
                "last_test_result": None,
                "human_review_count": 0,
                "cmp_type": "",
                "aborted_timeout": True,
                "extraction_duration_seconds": 0.0,
                "model_aborted": False,
                "abort_reason": "",
                "suspected_stuck_reason": "",
                "current_rule_draft": "",
            }
        log_run(
            timeout_state,
            duration_seconds=duration,
            model_name=MODEL_NAME,
            few_shot_config=FEW_SHOT_CONFIG,
            overall_timeout_seconds=timeout_seconds,
        )
        return

    if process.exitcode not in (0, None):
        print(f"Worker for {url} exited with code {process.exitcode}.")
        duration = time.perf_counter() - start_time
        recovered_state = load_checkpoint_state(thread_id)
        if recovered_state:
            recovered_state["last_error"] = f"ABORTED: worker crashed (exit code {process.exitcode})"
            recovered_state["aborted_worker_crash"] = True
            recovered_state["suspected_stuck_reason"] = recovered_state.get("suspected_stuck_reason") or detect_stuck_reason_from_state(recovered_state)
            crash_state = recovered_state
        else:
            crash_state = {
                "url": url,
                "batch_mode": True,
                "llm_calls": 0,
                "last_error": f"ABORTED: worker crashed (exit code {process.exitcode})",
                "final_result": None,
                "last_test_result": None,
                "human_review_count": 0,
                "cmp_type": "",
                "aborted_worker_crash": True,
                "extraction_duration_seconds": 0.0,
                "model_aborted": False,
                "abort_reason": "",
                "suspected_stuck_reason": "",
                "current_rule_draft": "",
            }
        log_run(
            crash_state,
            duration_seconds=duration,
            model_name=MODEL_NAME,
            few_shot_config=FEW_SHOT_CONFIG,
        )

def main() -> None:
    """
    Entry point for the batch evaluation pipeline.

    Iterates over evaluation_urls and runs the agent for each URL sequentially.
    All runs are logged to data/logs/runs/ (JSON) and data/logs/evaluation_summary.csv.
    """
    url_file_path = "evaluation/test_urls.txt"
    evaluation_urls = load_urls_from_file(url_file_path)
    timeout_seconds = 1800 #30min
    
    print(f"Batch Evaluation started: {len(evaluation_urls)} URLs")
    print(f"Model: {MODEL_NAME} | Few-Shot: {FEW_SHOT_CONFIG}\n")
    print(f"Per-URL overall timeout: {timeout_seconds}s\n")

    try:
        for i, url in enumerate(evaluation_urls, 1):
            print(f"\nProgress: {i}/{len(evaluation_urls)}")
            run_single_with_timeout(url, timeout_seconds)
    except KeyboardInterrupt:
        print("\n Batch run was interrupted by the user! Exiting...")
        sys.exit(0)

    print(f"\nBatch complete. Results in data/logs/")

if __name__ == "__main__":
    main()