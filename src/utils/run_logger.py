import json
import os
import csv
from datetime import datetime


def _has_non_empty_do_consent(final_rule_dict: dict) -> bool:
    """Returns True only if a DO_CONSENT method contains at least one consent mapping."""
    for cmp_data in final_rule_dict.values():
        if not isinstance(cmp_data, dict):
            continue

        methods = cmp_data.get("methods", [])
        for method in methods:
            if method.get("name") != "DO_CONSENT":
                continue

            action = method.get("action", {})
            consents = action.get("consents", [])
            if isinstance(consents, list) and len(consents) > 0:
                return True

    return False

def _derive_auto_success_failure_reasons(
    test_result: dict,
    final_test_error: str,
    final_rule,
    banner_dismissed: bool,
    state: dict,
) -> list[str]:
    """Returns explicit reasons explaining why auto_success evaluated to false."""
    reasons = []

    if test_result.get("handled") != True:
        reasons.append("engine_not_handled")
    if final_test_error:
        reasons.append("final_test_error_present")
    if final_rule is None:
        reasons.append("no_final_rule")
    if not banner_dismissed:
        reasons.append("banner_not_dismissed")
    if state.get("aborted_timeout") == True:
        reasons.append("overall_timeout")
    if state.get("last_error") == "ABORTED: max auto-resumes reached":
        reasons.append("max_auto_resumes_reached")
    if state.get("model_aborted") == True:
        reasons.append("model_aborted")

    return reasons


def log_run(
    state: dict,
    duration_seconds: float,
    model_name: str = "unknown",
    few_shot_config: str = "unknown",
    overall_timeout_seconds: int | None = None,
    aborted_max_resumes: bool | None = None,
) -> None:
    """
    Persists the evaluation metadata of a completed agent run.

    Writes two outputs:
    - A timestamped JSON file in data/logs/runs/ containing the full run record
        including the final rule, banner status, and complete error history.
    - An appended row in data/logs/evaluation_summary.csv for aggregated analysis.

    The auto_success flag is computed from four independent signals: CoM engine
    completion (handled), absence of selector errors in the final test run
    (final_test_error), presence of a valid LLM-generated rule (final_result),
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
    screenshot_info = state.get("screenshot_info") or {}
    vision_banner_dismissed = screenshot_info.get("bannerDismissed")
    
    banner_status = test_result.get("bannerStatus", {})
    baseline = banner_status.get("baseline", {})
    audit = banner_status.get("audit", {})
    
    error_history = state.get("error_history", [])
    final_test_error = test_result.get("error") or ""
    final_rule = state.get("final_result", None)
    
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
    # 3. final_result is set --> the LLM produced a valid <rule> output
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
    auto_success_failure_reasons = []
    if not auto_success:
        auto_success_failure_reasons = _derive_auto_success_failure_reasons(
            test_result=test_result,
            final_test_error=final_test_error,
            final_rule=final_rule,
            banner_dismissed=banner_dismissed,
            state=state,
        )
    
    final_rule_dict = {}
    if isinstance(final_rule, dict):
        final_rule_dict = final_rule

    has_non_empty_do_consent = _has_non_empty_do_consent(final_rule_dict)
    
    used_methods = []
    for cmp_data in final_rule_dict.values():
        if isinstance(cmp_data, dict):
            methods = cmp_data.get("methods", [])
            for method in methods:
                if "name" in method:
                    used_methods.append(method["name"])
    
    #strategy_type describes WHICH strategy the generated rule used (independent of success).
    #It distinguishes between genuinely granular consent handling and simpler fallback strategies,
    #which auto_success alone cannot capture (a banner dismissed via "Reject All" also counts as success)
    #
    #GRANULAR_CONSENT:          DO_CONSENT method present --> agent mapped individual categories (A/B/F/X)
    #DECLINE_FALLBACK:          No DO_CONSENT, but settings were extracted --> agent chose "Reject All"
    #                           despite a settings page being available (extraction succeeded, LLM fallback)
    #DECLINE_FALLBACK_OR_BINARY: No DO_CONSENT, no settings extracted --> either the banner had no
    #                           granular options (binary banner), or settings extraction failed silently.
    #                           Requires manual verification to distinguish.
    #UNKNOWN:                   Ruleset present but no recognizable method names found (should not occur).
    #MODEL_ABORTED              The LLM decided, based on instructions in the system prompt, the given banner is unsolvable with the current system 
    strategy_type = ""
    if has_non_empty_do_consent:
        strategy_type = "GRANULAR_CONSENT"
    elif "SAVE_CONSENT" in used_methods:
        if settings_extracted:
            strategy_type = "DECLINE_FALLBACK"
        else:
            strategy_type = "DECLINE_FALLBACK_OR_BINARY"
    elif state.get("model_aborted") == True:
        strategy_type = "MODEL_ABORTED"
    else:
        strategy_type = "UNKNOWN"
        
    extraction_duration_seconds = round(state.get("extraction_duration_seconds", 0), 2)
    total_duration_seconds = round(duration_seconds, 2)
    extraction_share_percent = round(
        (extraction_duration_seconds / total_duration_seconds) * 100, 2
    ) if total_duration_seconds > 0 else 0.0

    log_entry = {
        "timestamp": datetime.now().isoformat(),
        "url": url,
        "structured_dom_chars": state.get("structured_dom_chars", 0),
        "model_used": model_name,
        "few_shot_config": few_shot_config,
        "auto_success": auto_success,
        "auto_success_failure_reasons": auto_success_failure_reasons,
        "aborted_max_resumes": aborted_max_resumes, #only set when using the `batch_runner.py`
        "overall_timeout_seconds": overall_timeout_seconds, #only set when using the `batch_runner.py`
        "strategy_type": strategy_type,
        "verified": None,  #Manual override placeholder for ground-truth audits
        "cmp_type": state.get("cmp_type", ""),
        "settings_extracted": settings_extracted,
        "handled": test_result.get("handled"),
        "banner_dismissed": banner_dismissed,
        "vision_banner_dismissed": vision_banner_dismissed,
        "heuristic_vision_mismatch": heuristic_vision_mismatch,
        "llm_calls": state.get("llm_calls", 0),
        "human_review_count": state.get("human_review_count", 0),
        "test_rule_count": state.get("test_rule_count", 0),
        "analyze_screenshot_count": state.get("analyze_screenshot_count", 0),
        "current_rule_draft": state.get("current_rule_draft", ""),
        "last_error": state.get("last_error", ""),
        "abort_reason": state.get("abort_reason", ""),
        "suspected_stuck_reason": state.get("suspected_stuck_reason", ""),
        "model_aborted": state.get("model_aborted", False),
        "final_test_error": final_test_error,
        "error_history": error_history,
        "duration_seconds": total_duration_seconds,
        "extraction_duration_seconds": extraction_duration_seconds,
        "extraction_share_percent": extraction_share_percent,
        "banner_status": {
            "baseline": baseline,
            "audit": audit
        },
        "final_rule": final_rule,
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
        "aborted_max_resumes",
        "overall_timeout_seconds",
        "strategy_type",
        "verified",
        "cmp_type",
        "settings_extracted",
        "handled",
        "banner_dismissed",
        "vision_banner_dismissed",
        "heuristic_vision_mismatch",
        "llm_calls",
        "human_review_count",
        "test_rule_count",
        "analyze_screenshot_count",
        "last_error",
        "final_test_error",
        "error_history",
        "duration_seconds",
        "extraction_duration_seconds",
        "extraction_share_percent",
        "banner_status_baseline",
        "banner_status_audit",
        "final_rule",
    ]
    
    csv_row = [
        log_entry["timestamp"],
        log_entry["url"],
        log_entry["structured_dom_chars"],
        log_entry["model_used"],
        log_entry["few_shot_config"],
        log_entry["auto_success"],
        log_entry["aborted_max_resumes"],
        log_entry["overall_timeout_seconds"],
        log_entry["strategy_type"],
        log_entry["verified"],
        log_entry["cmp_type"],
        log_entry["settings_extracted"],
        log_entry["handled"],
        log_entry["banner_dismissed"],
        log_entry["vision_banner_dismissed"],
        log_entry["heuristic_vision_mismatch"],
        log_entry["llm_calls"],
        log_entry["human_review_count"],
        log_entry["test_rule_count"],
        log_entry["analyze_screenshot_count"],
        log_entry["last_error"],
        log_entry["final_test_error"],
        json.dumps(log_entry["error_history"], default=str),
        log_entry["duration_seconds"],
        log_entry["extraction_duration_seconds"],
        log_entry["extraction_share_percent"],
        json.dumps(baseline),
        json.dumps(audit),
        json.dumps(log_entry["final_rule"])
    ]
    
    file_exists = os.path.exists(csv_filename)
    
    with open(csv_filename, "a", encoding="utf-8", newline="") as f:
        writer = csv.writer(f)
        
        if not file_exists:
            writer.writerow(csv_headers)
        writer.writerow(csv_row)
    
    print(
        f"Run logged: {filename} | success={auto_success} | "
        f"failure_reasons={auto_success_failure_reasons} | "
        f"strategy_type={strategy_type} | llm_calls={log_entry['llm_calls']}"
    )