import json
import os
import csv
from datetime import datetime

def log_run(state: dict, duration_seconds: float, model_name: str = "unknown",  few_shot_config: str = "unknown") -> None:
    """
    Persists the evaluation metadata of a completed agent run.

    Writes two outputs:
    - A timestamped JSON file in data/logs/runs/ containing the full run record
        including the final ruleset, banner status, and complete error history.
    - An appended row in data/logs/evaluation_summary.csv for aggregated analysis.

    The auto_success flag is computed from four independent signals: CoM engine
    completion (handled), absence of selector errors in the final test run
    (final_test_error), presence of a valid LLM-generated ruleset (final_result),
    and confirmed banner dismissal via heuristic or TCF API signals (banner_dismissed).
    It does NOT verify correct consent category assignment (A/B/F/X), that
    requires manual annotation via the verified field.

    Args:
        state: The final LangGraph agent state after a completed run.
        duration_seconds: Total wall-clock time for the run in seconds.
        model_name: Identifier of the LLM used (e.g. "cavi/medium").
        few_shot_config: Description of the active few-shot configuration.
    """
    url = state.get("url", "unknown")
    test_result = state.get("last_test_result") or {}
    banner_status = test_result.get("bannerStatus", {})
    baseline = banner_status.get("baseline", {})
    audit = banner_status.get("audit", {})
    error_history = state.get("error_history", [])
    final_test_error = test_result.get("error") or ""
    final_ruleset = state.get("final_result", "No final ruleset")
    
    banner_dismissed = (
        (baseline.get("heuristicBannerFound") == True
        and audit.get("heuristicBannerFound") == False)
        or
        (baseline.get("hasTcfApi") == True and baseline.get("tcfVisible") == True
        and audit.get("hasTcfApi") == True and audit.get("tcfVisible") == False)
    )

    #auto_success is determined by four independent signals:
    # 1. handled: true  --> the CoM engine completed its execution flow
    # 2. no final_test_error --> the last test run produced no selector or action errors
    # 3. final_result is set --> the LLM produced a valid <ruleset> output
    # 4. banner_dismissed --> heuristicBannerFound flipped from True (baseline) to False (audit),
    #    confirming the banner is no longer detectable on the page; alternativly the CMP used the
    #    tcfApi and tcfVisible flipped from True (baseline) to False (audit)
    #
    #NOTE: This metric cannot verify correct consent category assignment (A/B/F/X).
    #It only confirms that the banner was successfully dismissed and all selectors resolved.
    #Category correctness requires manual verification via the "verified" field.
    auto_success = (
        test_result.get("handled") == True
        and not final_test_error
        and state.get("final_result") is not None
        and banner_dismissed
    )
    
    log_entry = {
        "timestamp": datetime.now().isoformat(),
        "url": url,
        "structured_dom_chars": state.get("structured_dom_chars", 0),
        "model_used": model_name,
        "few_shot_config": few_shot_config,
        "auto_success": auto_success,
        "verified": None,  #Manual override placeholder for ground-truth audits
        "cmp_type": state.get("cmp_type", ""),
        "handled": test_result.get("handled"),
        "banner_dismissed": banner_dismissed,
        "attempts": state.get("attempts", 0),
        "human_review_count": state.get("human_review_count", 0),
        "test_ruleset_count": state.get("test_ruleset_count", 0),
        "analyse_screenshot_count": state.get("analyse_screenshot_count", 0),
        "final_test_error": final_test_error,
        "error_history": error_history,
        "duration_seconds": round(duration_seconds, 2),
        "banner_status": {
            "baseline": baseline,
            "audit": audit
        },
        "final_ruleset": final_ruleset,
    }
    
    os.makedirs("data/logs/runs", exist_ok=True)
    
    clean_url = url.replace("https://", "").replace("http://", "").rstrip("/").replace("/", "_")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"data/logs/runs/{timestamp}_{clean_url}.json"
    
    with open(filename, "w", encoding="utf-8") as f:
        json.dump(log_entry, f, indent=2, ensure_ascii=False)
        
    csv_filename = "data/logs/evaluation_summary.csv"
    csv_headers = [
        "timestamp",
        "url",
        "structured_dom_chars",
        "model_used",
        "few_shot_config",
        "auto_success",
        "verified",
        "cmp_type",
        "handled",
        "banner_dismissed",
        "attempts",
        "human_review_count",
        "test_ruleset_count",
        "analyse_screenshot_count",
        "final_test_error",
        "error_history",
        "duration_seconds",
        "banner_status_baseline",
        "banner_status_audit",
        "final_ruleset",
    ]
    
    csv_row = [
        log_entry["timestamp"],
        log_entry["url"],
        log_entry["structured_dom_chars"],
        log_entry["model_used"],
        log_entry["few_shot_config"],
        log_entry["auto_success"],
        log_entry["verified"],
        log_entry["cmp_type"],
        log_entry["handled"],
        log_entry["banner_dismissed"],
        log_entry["attempts"],
        log_entry["human_review_count"],
        log_entry["test_ruleset_count"],
        log_entry["analyse_screenshot_count"],
        log_entry["final_test_error"],
        json.dumps(log_entry["error_history"], default=str),
        log_entry["duration_seconds"],
        json.dumps(baseline),
        json.dumps(audit),
        json.dumps(log_entry["final_ruleset"])
    ]
    
    file_exists = os.path.exists(csv_filename)
    
    with open(csv_filename, "a", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        
        if not file_exists:
            writer.writerow(csv_headers)
        writer.writerow(csv_row)
    
    print(f"Run logged: {filename} | success={auto_success} | attempts={log_entry['attempts']}")