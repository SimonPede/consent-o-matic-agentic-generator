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
    settings_extracted = state.get("settings_extracted", False)
    screenshot_info = state.get("screenshot_info", {})
    vision_banner_dismissed = screenshot_info.get("bannerDismissed")
    
    banner_status = test_result.get("bannerStatus", {})
    baseline = banner_status.get("baseline", {})
    audit = banner_status.get("audit", {})
    
    error_history = state.get("error_history", [])
    final_test_error = test_result.get("error") or ""
    final_ruleset = state.get("final_result", None)
    
    banner_dismissed = (
        (baseline.get("heuristicBannerFound") == True
        and audit.get("heuristicBannerFound") == False)
        or
        (baseline.get("hasTcfApi") == True
        and baseline.get("tcfVisible") == True
        and audit.get("hasTcfApi") == True
        and audit.get("tcfVisible") == False)
    )
    
    heuristic_vision_mismatch = False
    if vision_banner_dismissed is not None:
        heuristic_vision_mismatch = (banner_dismissed != vision_banner_dismissed)

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
    
    final_ruleset_dict = {}
    if isinstance(final_ruleset, dict):
        final_ruleset_dict = final_ruleset
    
    used_methods = []
    for cmp_data in final_ruleset_dict.values():
        if isinstance(cmp_data, dict):
            methods = cmp_data.get("methods", [])
            for method in methods:
                if "name" in method:
                    used_methods.append(method["name"])
    
    #resolution_type classifies the outcome of a successful run into one of four categories.
    #It distinguishes between genuinely granular consent handling and simpler fallback strategies,
    #which auto_success alone cannot capture (a banner dismissed via "Reject All" also counts as success)
    #
    #GRANULAR_CONSENT:          DO_CONSENT method present --> agent mapped individual categories (A/B/F/X)
    #DECLINE_FALLBACK:          No DO_CONSENT, but settings were extracted --> agent chose "Reject All"
    #                           despite a settings page being available (extraction succeeded, LLM fallback)
    #DECLINE_FALLBACK_OR_BINARY: No DO_CONSENT, no settings extracted --> either the banner had no
    #                           granular options (binary banner), or settings extraction failed silently.
    #                           Requires manual verification to distinguish.
    #FAILED:                    auto_success is False --> banner not dismissed or no valid ruleset produced.
    #UNKNOWN:                   Ruleset present but no recognizable method names found (should not occur).
    resolution_type = ""
    if not auto_success:
        resolution_type = "FAILED"
    elif "DO_CONSENT" in used_methods:
        resolution_type = "GRANULAR_CONSENT"
    elif "SAVE_CONSENT" in used_methods:
        if settings_extracted:
            resolution_type = "DECLINE_FALLBACK"
        else:
            resolution_type = "DECLINE_FALLBACK_OR_BINARY"
    else:
        resolution_type = "UNKNOWN"
        
    log_entry = {
        "timestamp": datetime.now().isoformat(),
        "url": url,
        "structured_dom_chars": state.get("structured_dom_chars", 0),
        "model_used": model_name,
        "few_shot_config": few_shot_config,
        "auto_success": auto_success,
        "resolution_type": resolution_type,
        "verified": None,  #Manual override placeholder for ground-truth audits
        "cmp_type": state.get("cmp_type", ""),
        "settings_extracted": settings_extracted,
        "handled": test_result.get("handled"),
        "banner_dismissed": banner_dismissed,
        "vision_banner_dismissed": vision_banner_dismissed,
        "heuristic_vision_mismatch": heuristic_vision_mismatch,
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
        "resolution_type",
        "verified",
        "cmp_type",
        "settings_extracted",
        "handled",
        "banner_dismissed",
        "vision_banner_dismissed",
        "heuristic_vision_mismatch",
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
        log_entry["resolution_type"],
        log_entry["verified"],
        log_entry["cmp_type"],
        log_entry["settings_extracted"],
        log_entry["handled"],
        log_entry["banner_dismissed"],
        log_entry["vision_banner_dismissed"],
        log_entry["heuristic_vision_mismatch"],
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
    
    print(f"Run logged: {filename} | success={auto_success} | resolution={resolution_type} | attempts={log_entry['attempts']}")