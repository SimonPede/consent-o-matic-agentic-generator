from __future__ import annotations

import ast
from pathlib import Path

import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
from scipy.stats import chi2_contingency
from statsmodels.stats.proportion import proportions_ztest

PRIMARY_MODEL = "openai/natai/kimi-k2.5"
MODEL_CONFIGS = [
    ("openai/natai/kimi-k2.5", "Kimi K2.6"),
    ("gemma4:31b", "Gemma 4 31B (dense)"),
    ("gemma4:26b", "Gemma 4 26B (MoE)"),
]

ROOT_DIR = Path(__file__).resolve().parent.parent

CSV_PATH = ROOT_DIR / "data" / "logs" / "evaluation_summary.csv"
CSV_PATH_KIMI = ROOT_DIR / "data" / "results" / "KimiK2.6-Eval-260826" / "logs" / "KimiK2.6-Eval-260826.csv"
CSV_PATH_GEMMA31B = ROOT_DIR / "data" / "results" / "Gemma31b-Eval-270826" / "logs" / "Gemma31b-Eval-270826.csv"
CSV_PATH_GEMMA26B = ROOT_DIR / "data" / "results" / "Gemma26b-Eval-270826" / "logs" / "Gemma26b-Eval-270826.csv"

ALL_URLS_PATH = ROOT_DIR / "evaluation" / "reported_urls.txt"
ALL_URLS_110_PATH = ROOT_DIR / "evaluation" / "urls_110_merged.txt"
TOP_10_CMP_URLS_PATH = ROOT_DIR / "evaluation" / "top_10_cmp_homepages.txt"
RQ1_PLOT_PATH = ROOT_DIR / "evaluation" / "rq1_summary.png"
RQ1_STRATEGY_PLOT_PATH = ROOT_DIR / "evaluation" / "rq1_strategy_distribution.png"
RQ2_PLOT_PATH = ROOT_DIR / "evaluation" / "rq2_dom_complexity.png"
RQ3_PLOT_PATH = ROOT_DIR / "evaluation" / "rq3_self_correction_boxplot.png"
RQ4_PLOT_PATH = ROOT_DIR / "evaluation" / "rq4_model_comparison.png"
RQ4_STRATEGY_PLOT_PATH = ROOT_DIR / "evaluation" / "rq4_model_strategy_comparison.png"
RQ5_PLOT_PATH = ROOT_DIR / "evaluation" / "rq5_primary_failure_labels.png"

STRATEGY_ORDER = [
    "GRANULAR_CONSENT",
    "DECLINE_FALLBACK",
    "DECLINE_FALLBACK_OR_BINARY",
    "MODEL_ABORTED",
    "UNKNOWN",
]

#these manually verified URLs were only verified for Kimi!

MANUALLY_VERIFIED_BLOCKED_OR_OUT_OF_SCOPE_URLS = {
    #Blocking
    "https://allegro.pl/",
    "https://www.bestbuy.ca/",
    "https://www.bol.com/",
    "https://www.patreon.com/",
    "https://www.bbc.co.uk/",
    "https://sourceforge.net/",
    "https://tweakers.net/",
    "https://www.etsy.com/",
    "https://www.svtplay.se/",
    "https://www.ebay.co.uk/",
    "https://www.ebay.de/",
    #Sourcepoint (pcgamer and techradar as edge-cases excluded):
    "https://www.zeit.de",
    "https://www.welt.de",
    "https://www.bild.de",
    "https://www.computerbild.de",
    "https://www.n-tv.de",
    "https://www.stern.de",
    "https://www.chip.de",
    "https://www.xda-developers.com",
    "https://www.t-online.de",
    "https://t3n.de",
    "https://www.dailymotion.com",
    "https://www.faz.net", #LLM identified Sourcepoint on its own
    #PAY_OR_CONSENT
    "https://elpais.com",
    "https://www.kleinanzeigen.de", #the actual reason being that the settings button leads to a different URL
    "https://www.leboncoin.fr",
}

MANUALLY_VERIFIED_SUCCESS_URLS = {
    #heuristic_vision_mismatch
    "https://www.vg.no",
    "https://www.asus.com",
    "https://www.ea.com/",
    "https://www.bing.com",
    "https://www.zdf.de",
    "https://ground.news",
    "https://find-and-update.company-information.service.gov.uk",
    "https://www.temu.com",
    "https://www.samsung.com",
    #URLs with rule_generated + no_final_test_error 
    "https://www.dw.com",
    #this error was thrown, but the rules does work after all:
    #Puppeteer Error in test_rule: Protocol error (Runtime.callFunctionOn): Execution context was destroyed.
    "https://www.pornhub.com",
    "https://www.royalmail.com",
    "https://www.ryanair.com",
    "https://www.diy.com",
    #this error was thrown, but the rules does work after all:
    #Puppeteer Error in test_rule: Execution context was destroyed, most likely because of a navigation."
    "https://www.nu.nl",
    #Selector Failed: ACTION_TARGET_NOT_FOUND: [aria-label='Alles ablehnen']:
    "https://taz.de",
    #URLs that work from the 10 CMP homepages subset
    "https://www.cookieyes.com/",
    "https://www.onetrust.com/",
    "https://www.osano.com/",
    "https://www.termsfeed.com/",
    "https://cookieinformation.com/",
    "https://advertising.inmobi.com/",
    "https://www.didomi.io/",
}

MANUALLY_VERIFIED_FAILURE_URLS = {
    "https://store.steampowered.com",
    "https://www.howtogeek.com",
    "https://www.test.de",
    "https://www.makeuseof.com",
    "https://gamerant.com",
    "https://kb.synology.com",
    #both Sourcepoint Edge-cases mentioned above
    "https://www.pcgamer.com",
    "https://www.techradar.com",
    #auto_success=false
    "https://www.amazon.de",
    "https://www.tumblr.com",
    #context window exploded
    "https://www.wp.pl",
    #URLs that dont work from the 10 CMP homepages subset
    "https://cookie-script.com/",
    "https://www.mooveagency.com/",
    "https://usercentrics.com/",
}

###################################################
#Small helper functions

def load_results_csv() -> pd.DataFrame | None:
    if not CSV_PATH.exists():
        print(f"Error during evaluation: The file {CSV_PATH} could not be found!")
        return None

    df = pd.read_csv(CSV_PATH)
    print(f"{len(df)} runs were loaded!")
    return df

def stage_pct(funnel: pd.DataFrame, stage_name: str) -> float:
    if funnel.empty:
        return 0.0
    row = funnel.loc[funnel["stage"] == stage_name, "pct_of_total"]
    return float(row.iloc[0]) if not row.empty else 0.0

def load_url_list(path: Path) -> list[str]:
    if not path.exists():
        print(f"Error during evaluation: The file {path} could not be found!")
        return []

    with path.open("r", encoding="utf-8") as f:
        return [line.strip() for line in f if line.strip()]

def to_bool(value) -> bool:
    if pd.isna(value):
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value == 1
    return str(value).strip().lower() in {"true", "1", "yes", "y"}

def pct(count: int, total: int) -> str:
    if total == 0:
        return "0.00%"
    return f"{(count / total) * 100:.2f}%"

def format_count_rate(count: int, total: int) -> str:
    return f"{count}/{total} ({pct(count, total)})"

def is_blank(value) -> bool:
    """Treats NaN/None and empty or whitespace-only strings as 'blank'."""
    if pd.isna(value):
        return True
    return str(value).strip() == ""

def normalize_url_for_matching(url: str) -> str:
    return str(url).strip().rstrip("/")

def build_subset(df: pd.DataFrame, url_list: list[str], model: str | None = None) -> pd.DataFrame:
    normalized_urls = {normalize_url_for_matching(url) for url in url_list}
    normalized_row_urls = df["url"].map(normalize_url_for_matching)
    subset = df[normalized_row_urls.isin(normalized_urls)].copy()
    if model is not None:
        subset = subset[subset["model_used"].astype(str).str.strip() == model]
    return subset

def build_manual_blocked_mask(df: pd.DataFrame) -> pd.Series:
    normalized_blocked_urls = {
        normalize_url_for_matching(url) for url in MANUALLY_VERIFIED_BLOCKED_OR_OUT_OF_SCOPE_URLS
    }
    return df["url"].map(normalize_url_for_matching).isin(normalized_blocked_urls)

def build_manual_mismatch_success_mask(df: pd.DataFrame) -> pd.Series:
    normalized_urls = {
        normalize_url_for_matching(url) for url in MANUALLY_VERIFIED_SUCCESS_URLS
    }
    return df["url"].map(normalize_url_for_matching).isin(normalized_urls)

def build_manual_verified_failure_mask(df: pd.DataFrame) -> pd.Series:
    normalized_urls = {
        normalize_url_for_matching(url) for url in MANUALLY_VERIFIED_FAILURE_URLS
    }
    return df["url"].map(normalize_url_for_matching).isin(normalized_urls)

def get_effective_success_series(df: pd.DataFrame) -> pd.Series:
    """
    Best-available success label after manual verification was incorporated.

    This corrected series is used for the single-model Kimi analyses after RQ1.
    Manual spot checks override the raw logger value where available.

    Important: RQ4 intentionally does NOT use this corrected series, because
    the cross-model comparison must stay anchored in the same automated metric
    for all backbones.
    """
    raw = df["auto_success"].map(to_bool)
    manual_success = build_manual_mismatch_success_mask(df)
    manual_failure = build_manual_verified_failure_mask(df)

    return (raw & ~manual_failure) | manual_success

def as_clean_str(value) -> str:
    if pd.isna(value):
        return ""
    return str(value).strip()

def parse_list_cell(value) -> list[str]:
    """Parses CSV list cells such as "['a', 'b']" into a Python list."""
    if pd.isna(value):
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]

    text = str(value).strip()
    if not text:
        return []

    try:
        parsed = ast.literal_eval(text)
    except (ValueError, SyntaxError):
        parsed = None

    if isinstance(parsed, list):
        return [str(item).strip() for item in parsed if str(item).strip()]

    return [text]

def count_list_entries(series: pd.Series) -> pd.Series:
    counts: dict[str, int] = {}
    for value in series:
        for item in parse_list_cell(value):
            counts[item] = counts.get(item, 0) + 1
    return pd.Series(counts).sort_values(ascending=False)

def contains_any_keyword(series: pd.Series, keywords: list[str]) -> pd.Series:
    lowered = series.fillna("").astype(str).str.lower()
    mask = pd.Series(False, index=series.index)
    for keyword in keywords:
        mask = mask | lowered.str.contains(keyword, regex=False)
    return mask

#Shared helper (used by RQ1 and RQ4)
def strategy_shares(df: pd.DataFrame, label: str) -> pd.DataFrame:
    filled = df["strategy_type"].fillna("MISSING")
    counts = filled.value_counts()
    counts = counts.reindex(STRATEGY_ORDER, fill_value=0)
    
    if "MISSING" in counts.index and counts["MISSING"] > 0:
        print(f"WARNING: {counts['MISSING']} rows with missing strategy_type were dropped from the plot.")
    #the strategy MISSING does not get plotted as it is not relevant with zero cases and only makes the plot less pretty
    
    shares = (counts / len(df) * 100) if len(df) > 0 else counts * 0
    return pd.DataFrame({"dataset": label, "strategy_type": shares.index, "share": shares.values})

def plot_strategy_bars(combined: pd.DataFrame, save_path: Path, title: str) -> None:
    sns.set_theme(style="whitegrid")
    plt.figure(figsize=(9, 5))
    ax = sns.barplot(data=combined, x="strategy_type", y="share", hue="dataset", palette="Set2")
    ax.set_ylabel("Share of runs (%)")
    ax.set_xlabel("")
    ax.set_title(title)
    plt.xticks(rotation=20, ha="right")
    plt.tight_layout()
    plt.savefig(save_path, dpi=250)
    plt.close()
    print(f"\nSaved strategy distribution plot to: {save_path}")

###################################################
#RQ1:

STRATEGY_DISPLAY_LABELS = {
    "GRANULAR_CONSENT": "Granular Consent",
    "DECLINE_FALLBACK": "Decline Fallback",
    "DECLINE_FALLBACK_OR_BINARY": "Decline Fallback or Binary",
    "MODEL_ABORTED": "Model Aborted",
    "UNKNOWN": "Unknown",
}

def apply_strategy_display_labels(df: pd.DataFrame) -> pd.DataFrame:
    labeled = df.copy()
    labeled["strategy_type"] = labeled["strategy_type"].map(STRATEGY_DISPLAY_LABELS).fillna(labeled["strategy_type"])
    return labeled

def get_auto_success_with_vision_series(df: pd.DataFrame) -> pd.Series:
    """
    Vision-supported variant of the raw automated success metric.

    This is still an automated metric: it supplements the raw structural banner
    dismissal signal with the screenshot audit, but it does not incorporate any
    manual verification.
    """
    if "auto_success_with_vision" in df.columns:
        return df["auto_success_with_vision"].map(to_bool)

    handled = df["handled"].map(to_bool) if "handled" in df.columns else pd.Series(False, index=df.index)
    no_final_test_error = df["final_test_error"].map(is_blank) if "final_test_error" in df.columns else pd.Series(False, index=df.index)
    has_final_rule = df["final_rule"].notna() if "final_rule" in df.columns else pd.Series(False, index=df.index)
    banner_dismissed = df["banner_dismissed"].map(to_bool) if "banner_dismissed" in df.columns else pd.Series(False, index=df.index)
    vision_banner_dismissed = df["vision_banner_dismissed"].map(to_bool) if "vision_banner_dismissed" in df.columns else pd.Series(False, index=df.index)

    return handled & no_final_test_error & has_final_rule & (banner_dismissed | vision_banner_dismissed)

def build_rq1_manual_adjusted_success_table(df: pd.DataFrame, label: str) -> pd.DataFrame:
    total_count = len(df)
    if total_count == 0:
        return pd.DataFrame(columns=["dataset", "metric", "successes", "denominator", "rate", "excluded_runs"])

    raw_auto_success = df["auto_success"].map(to_bool)
    raw_auto_success_with_vision = get_auto_success_with_vision_series(df)
    effective_auto_success = get_effective_success_series(df)

    blocked_mask = build_manual_blocked_mask(df)
    in_scope_df = df[~blocked_mask].copy()
    cleaned_in_scope_effective_success = get_effective_success_series(in_scope_df)

    rows = [
        {
            "dataset": label,
            "metric": "Raw auto_success",
            "successes": int(raw_auto_success.sum()),
            "denominator": total_count,
            "rate": format_count_rate(int(raw_auto_success.sum()), total_count),
            "excluded_runs": 0,
        },
        {
            "dataset": label,
            "metric": "Raw auto_success_with_vision",
            "successes": int(raw_auto_success_with_vision.sum()),
            "denominator": total_count,
            "rate": format_count_rate(int(raw_auto_success_with_vision.sum()), total_count),
            "excluded_runs": 0,
        },
        {
            "dataset": label,
            "metric": "Raw auto_success + manually verified successes",
            "successes": int(effective_auto_success.sum()),
            "denominator": total_count,
            "rate": format_count_rate(int(effective_auto_success.sum()), total_count),
            "excluded_runs": 0,
        },
        {
            "dataset": label,
            "metric": "Cleaned in-scope + manually verified successes",
            "successes": int(cleaned_in_scope_effective_success.sum()),
            "denominator": len(in_scope_df),
            "rate": format_count_rate(int(cleaned_in_scope_effective_success.sum()), len(in_scope_df)),
            "excluded_runs": int(blocked_mask.sum()),
        },
    ]
    return pd.DataFrame(rows)

def summarize_remaining_unreviewed_urls(df: pd.DataFrame, label: str) -> None:
    print(f"\n--- Remaining manually unreviewed URLs: {label} ---")

    if len(df) == 0:
        print("No rows found for this subset.")
        return

    manually_reviewed_urls = {
        normalize_url_for_matching(url)
        for url in (
            MANUALLY_VERIFIED_SUCCESS_URLS
            | MANUALLY_VERIFIED_FAILURE_URLS
            | MANUALLY_VERIFIED_BLOCKED_OR_OUT_OF_SCOPE_URLS
        )
    }

    normalized_row_urls = df["url"].map(normalize_url_for_matching)
    unreviewed = df[~normalized_row_urls.isin(manually_reviewed_urls)].copy()

    print(
        "URLs not covered by MANUALLY_VERIFIED_SUCCESS_URLS, "
        "MANUALLY_VERIFIED_FAILURE_URLS, or "
        "MANUALLY_VERIFIED_BLOCKED_OR_OUT_OF_SCOPE_URLS:"
    )
    print(f"{len(unreviewed)}/{len(df)}")
    if unreviewed.empty:
        print("None.")
    else:
        print(unreviewed["url"].to_string(index=False))

def summarize_abort_and_failure_breakdown(df: pd.DataFrame, label: str) -> None:
    print(f"\n--- Abort and failure breakdown: {label} ---")

    if len(df) == 0:
        print("No rows found for this subset.")
        return

    if "abort_code" in df.columns:
        abort_codes = df["abort_code"].fillna("").astype(str).str.strip()
        abort_counts = abort_codes[abort_codes != ""].value_counts()
        print("\nAbort code counts:")
        if abort_counts.empty:
            print("No model aborts recorded.")
        else:
            print(abort_counts.to_string())

    if "auto_success_failure_reasons" in df.columns:
        failed_runs = df[~df["auto_success"].map(to_bool)]
        reason_counts = count_list_entries(failed_runs["auto_success_failure_reasons"])
        print("\nFailure reason counts among auto_success=False runs:")
        if reason_counts.empty:
            print("No failure reasons recorded.")
        else:
            print(reason_counts.to_string())

def summarize_adjusted_success_rates(df: pd.DataFrame, label: str) -> None:
    print(f"\n--- Adjusted success rates: {label} ---")

    if len(df) == 0:
        print("No rows found for this subset.")
        return

    abort_code = df["abort_code"].fillna("").astype(str).str.strip()

    sourcepoint_mask = (abort_code == "SOURCEPOINT_FIRST_LAYER_NO_REJECT")
    no_banner_detected_mask = (abort_code == "NO_BANNER_DETECTED")
    pay_or_consent_mask = (abort_code == "PAY_OR_CONSENT_DEAD_END")
    manually_blocked_mask = build_manual_blocked_mask(df)
    
    scenarios = [
        ("Raw sample", pd.Series(False, index=df.index)),
        ("Without SOURCEPOINT_FIRST_LAYER_NO_REJECT cases", sourcepoint_mask),
        ("Without manually verified out-of scope URLs", manually_blocked_mask),
        ("Without SOURCEPOINT_FIRST_LAYER_NO_REJECT cases and manually verified out-of scope URLs", sourcepoint_mask | manually_blocked_mask),
        ("Without NO_BANNER_DETECTED cases", no_banner_detected_mask),
        ("Without NO_BANNER_DETECTED and PAY_OR_CONSENT_DEAD_END cases", no_banner_detected_mask | pay_or_consent_mask),
        ("Without all categories above", sourcepoint_mask | no_banner_detected_mask | pay_or_consent_mask),
        ("Without all abort cases and verified out-of scope URLs", sourcepoint_mask | manually_blocked_mask | no_banner_detected_mask | pay_or_consent_mask),
    ]

    rows = []
    for scenario_name, excluded_mask in scenarios:
        included = df[~excluded_mask]
        if not included.empty:
            included_success = included["auto_success"].map(to_bool)
            included_success_with_vision = get_auto_success_with_vision_series(included)
        else:
            included_success = pd.Series(dtype=bool)
            included_success_with_vision = pd.Series(dtype=bool)
        rows.append({
            "scenario": scenario_name,
            "excluded_runs": int(excluded_mask.sum()),
            "remaining_runs": len(included),
            "successes": int(included_success.sum()) if not included.empty else 0,
            "success_rate": pct(int(included_success.sum()) if not included.empty else 0, len(included)),
            "successes_with_vision": int(included_success_with_vision.sum()) if not included.empty else 0,
            "success_rate_with_vision": pct(
                int(included_success_with_vision.sum()) if not included.empty else 0,
                len(included),
            ),
        })

    adjusted = pd.DataFrame(rows)
    print(adjusted.to_string(index=False))

    # if sourcepoint_mask.any():
    #     print("\nExcluded as SOURCEPOINT_FIRST_LAYER_NO_REJECT:")
    #     print(df.loc[sourcepoint_mask, "url"].to_string(index=False))
    #     print(df.loc[sourcepoint_mask, "url"].count())

    # if no_banner_detected_mask.any():
    #     print("\nExcluded as NO_BANNER_DETECTED:")
    #     print(df.loc[no_banner_detected_mask, "url"].to_string(index=False))
    #     print(df.loc[no_banner_detected_mask, "url"].count())

    # if pay_or_consent_mask.any():
    #     print("\nURLs labeled by the model as PAY_OR_CONSENT_DEAD_END:")
    #     print(df.loc[pay_or_consent_mask, "url"].to_string(index=False))
    #     print(df.loc[pay_or_consent_mask, "url"].count())

    # if manually_blocked_mask.any():
    #     print("\nExcluded as manually verified blocked / inaccessible:")
    #     print(df.loc[manually_blocked_mask, "url"].to_string(index=False))
    #     print(df.loc[manually_blocked_mask, "url"].count())
            
def plot_strategy_distribution(df_all_sample: pd.DataFrame, df_top_10_cmp_subset: pd.DataFrame) -> None:
    """
    Visualizes the distribution of strategy_type across the two RQ1 samples,
    complementing the binary auto_success_rate with the underlying resolution
    strategy (granular consent handling vs. the various fallback/abort paths).
    Missing-field cases (older log schema versions) are tracked separately from
    the genuine UNKNOWN classification to avoid conflating the two meanings.
    """
    combined = pd.concat([
            strategy_shares(df_all_sample, "Full 100-Website Sample"),
            strategy_shares(df_top_10_cmp_subset, "10 CMP-Provider Subset"),
        ], ignore_index=True)
    
    combined = apply_strategy_display_labels(combined)
    plot_strategy_bars(combined, RQ1_STRATEGY_PLOT_PATH, "RQ1: strategy_type distribution")

def analyze_success_reliability(df: pd.DataFrame, all_urls: list[str]) -> None:
    """
    Reliability check on the raw automated success metric.

    This function intentionally stays on the raw logger-level auto_success
    value, because its purpose is to diagnose how trustworthy that automated
    metric is before any manual correction is applied.
    """
    print("Analyzing success-metric reliability (heuristic vs. vision mismatch)\n")

    df_all_sample = build_subset(df, all_urls).copy()
    if df_all_sample.empty:
        return

    df_all_sample["raw_auto_success"] = df_all_sample["auto_success"].map(to_bool)
    df_all_sample["raw_auto_success_with_vision"] = get_auto_success_with_vision_series(df_all_sample)
    mismatch = df_all_sample["heuristic_vision_mismatch"].map(to_bool)

    total = len(df_all_sample)
    mismatch_count = int(mismatch.sum())
    print(f"Heuristic/vision mismatch across full sample: {mismatch_count}/{total} ({pct(mismatch_count, total)})")
    non_blocked_mismatch_runs = df_all_sample[mismatch & ~build_manual_blocked_mask(df_all_sample)]
    if not non_blocked_mismatch_runs.empty:
        print("\nURLs with a heuristic/vision mismatch that are NOT part of the manually blocked/out-of-scope set:")
        print(non_blocked_mismatch_runs["url"].to_string(index=False))
    strict_success_count = int(df_all_sample["raw_auto_success"].sum())
    success_with_vision_count = int(df_all_sample["raw_auto_success_with_vision"].sum())
    print(
        f"\nStrict auto_success vs. auto_success_with_vision: "
        f"{strict_success_count}/{total} vs. {success_with_vision_count}/{total}"
    )
    if success_with_vision_count > strict_success_count:
        recovered = df_all_sample[
            (~df_all_sample["raw_auto_success"]) & df_all_sample["raw_auto_success_with_vision"]
        ]
        print(
            f"\nRuns recovered only by the vision-supported metric: "
            f"{len(recovered)}/{total} ({pct(len(recovered), total)})"
        )
        print(recovered["url"].to_string(index=False))

    successful = df_all_sample[df_all_sample["raw_auto_success"]]
    if not successful.empty:
        mismatch_in_success = successful["heuristic_vision_mismatch"].map(to_bool)
        s_total = len(successful)
        s_mismatch = int(mismatch_in_success.sum())
        print(f"Mismatch among auto_success=True runs: {s_mismatch}/{s_total} ({pct(s_mismatch, s_total)})")

        if s_mismatch > 0:
            print("\nURLs flagged successful but with a heuristic/vision mismatch (candidates for manual spot-checking):")
            print(successful.loc[mismatch_in_success, "url"].to_string(index=False))
    else:
        print("No successful runs found.")
    
    unsuccessful = df_all_sample[df_all_sample["raw_auto_success"] == False]
    if not unsuccessful.empty:
        mismatch_in_no_success = unsuccessful["heuristic_vision_mismatch"].map(to_bool)
        s_total = len(unsuccessful)
        s_mismatch = int(mismatch_in_no_success.sum())
        print(f"Mismatch among auto_success=False runs: {s_mismatch}/{s_total} ({pct(s_mismatch, s_total)})")

        # if s_mismatch > 0:
        #     print("\nURLs flagged unsuccessful but with a heuristic/vision mismatch (candidates for manual spot-checking):")
        #     print(unsuccessful.loc[mismatch_in_no_success, "url"].to_string(index=False))
    else:
        print("No unsuccessful runs found.")

def success_funnel(df: pd.DataFrame, label: str) -> pd.DataFrame:
    """
    Breaks the raw automated outcome down into successive stages.

    This helper intentionally uses the raw automated metrics, because RQ1 is
    where the raw logger-level success signal is explicitly compared against
    the vision-supported and manually corrected variants.
    """
    total = len(df)
    if total == 0:
        print(f"\n--- Success funnel: {label} --- (no runs)")
        return pd.DataFrame()

    rule_generated = df["final_rule"].notna()
    no_final_test_error = df["final_test_error"].map(is_blank)
    raw_auto_success = df["auto_success"].map(to_bool)
    raw_auto_success_with_vision = get_auto_success_with_vision_series(df)

    stage_rule = rule_generated
    stage_clean_test = rule_generated & no_final_test_error
    stage_success = stage_clean_test & raw_auto_success
    stage_success_with_vision = stage_clean_test & raw_auto_success_with_vision

    stages = [
        ("Total runs", total),
        ("Rule generated", int(stage_rule.sum())),
        ("...and no live-test error", int(stage_clean_test.sum())),
        ("...and counted as auto_success", int(stage_success.sum())),
        ("...and counted as auto_success_with_vision", int(stage_success_with_vision.sum())),
    ]

    funnel = pd.DataFrame(stages, columns=["stage", "count"])
    funnel["pct_of_total"] = (funnel["count"] / total * 100).round(2)

    clean_final_test_runs = df[stage_clean_test]
    if not clean_final_test_runs.empty:
        print("\nURLs with generated rule and no live-test error:")
        print(clean_final_test_runs["url"].count())
        #print(clean_final_test_runs["url"].to_string(index=False))

        clean_test_but_not_success = clean_final_test_runs[~clean_final_test_runs["auto_success"].map(to_bool)]
        if not clean_test_but_not_success.empty:
            print("\nSubset of the above that still were not counted as auto_success:")
            print(clean_test_but_not_success["url"].to_string(index=False))

    #Sanity check: the last funnel stage should equal the raw auto_success count exactly.
    raw_success_count = int(raw_auto_success.sum())
    if int(stage_success.sum()) != raw_success_count:
        print(
            f"WARNING: funnel's final stage ({int(stage_success.sum())}) does not match "
            f"raw auto_success count ({raw_success_count}) — check for a logging inconsistency "
            f"between final_rule / final_test_error / auto_success."
        )

    raw_success_with_vision_count = int(raw_auto_success_with_vision.sum())
    if int(stage_success_with_vision.sum()) != raw_success_with_vision_count:
        print(
            f"WARNING: funnel's vision-supported final stage ({int(stage_success_with_vision.sum())}) "
            f"does not match raw auto_success_with_vision count ({raw_success_with_vision_count})."
        )

    return funnel

def summarize_subset(df: pd.DataFrame, label: str) -> None:
    total_count = len(df)
    print(f"\n--- {label} ({total_count} runs) ---")

    if total_count == 0:
        print("No rows found for this subset.")
        return

    #RQ1 deliberately compares raw automated success against the augmented
    #variants instead of choosing just one of them.
    raw_auto_success = df["auto_success"].map(to_bool)
    raw_auto_success_with_vision = get_auto_success_with_vision_series(df)
    effective_auto_success = get_effective_success_series(df)
    success_count = int(raw_auto_success.sum())
    success_with_vision_count = int(raw_auto_success_with_vision.sum())
    success_with_manual_corrections_count = int(effective_auto_success.sum())
    
    print(f"Automated success rate: {success_count}/{total_count} ({pct(success_count, total_count)})")
    print(
        f"Automated success rate incl. vision audit: "
        f"{success_with_vision_count}/{total_count} ({pct(success_with_vision_count, total_count)})"
    )
    print(
        f"Automated success rate with manually verified successes: "
        f"{success_with_manual_corrections_count}/{total_count} "
        f"({pct(success_with_manual_corrections_count, total_count)})"
    )
    if success_with_vision_count > success_count:
        print(f"Additional runs counted only by the vision-supported metric: {success_with_vision_count - success_count}")
    if success_with_manual_corrections_count > success_count:
        print(
            f"Additional runs counted only by manually verified successes: "
            f"{success_with_manual_corrections_count - success_count}"
        )
        
    #Only RQ1 removes manually verified blocked / out-of-scope URLs from a
    #denominator, because only RQ1 reports the cleaned in-scope headline rate.
    blocked_mask = build_manual_blocked_mask(df)
    in_scope = df[~blocked_mask].copy()
    if in_scope.empty:
        print("No in-scope rows remain after excluding manually verified blocked/out-of-scope URLs.")
        return
        
    cleaned_in_scope_effective_success = get_effective_success_series(in_scope)
    cleaned_success_count = int(cleaned_in_scope_effective_success.sum())
    print(
        f"Cleaned in-scope success rate (auto_success + manually verified successes, "
        f"excluding blocked/out-of-scope URLs): {cleaned_success_count}/{len(in_scope)} "
        f"({pct(cleaned_success_count, len(in_scope))})"
    )
    
    if "final_rule" in df.columns:
        rules_generated_count = int(df["final_rule"].notna().sum())
        print(f"Runs with a generated JSON rule: {rules_generated_count}/{total_count} ({pct(rules_generated_count, total_count)})")

    if "strategy_type" in df.columns:
        print("\nStrategy counts:")
        print(df["strategy_type"].fillna("MISSING_COMPLETELY").value_counts().to_string())

        unknown_urls = df.loc[df["strategy_type"] == "UNKNOWN", "url"]
        if not unknown_urls.empty:
            print(f"\nURLs with strategy_type == UNKNOWN ({len(unknown_urls)}):")
            print(unknown_urls.to_string(index=False))

        print("\nStrategy counts among successful runs:")
        successful_runs = df[raw_auto_success]
        if not successful_runs.empty:
            print(successful_runs["strategy_type"].fillna("MISSING_COMPLETELY").value_counts().to_string())
        else:
            print("No successful runs found.")

#main function for this RQ
def analyze_rq1(df: pd.DataFrame, all_urls: list[str], top_10_cmp_urls: list[str]) -> None:
    """
    RQ1: What functional solution quality do the autonomously generated rules exhibit,
    as measured by the automated success rate across the full 100-website sample,
    complemented by the CMP-provider subset where the results also get manually verified.
    """

    print("\nAnalyzing RQ1: Functional Solution Quality\n")

    df_all_sample = build_subset(df, all_urls)
    df_top_10_cmp_subset = build_subset(df, top_10_cmp_urls)

    summarize_subset(df_all_sample, "Full 100-Website Sample")
    summarize_subset(df_top_10_cmp_subset, "10 CMP-Provider Subset")
    
    summarize_abort_and_failure_breakdown(df_all_sample, "Full 100-Website Sample")
    summarize_abort_and_failure_breakdown(df_top_10_cmp_subset, "10 CMP-Provider Subset")
    
    summarize_adjusted_success_rates(df_all_sample, "Full 100-Website Sample")

    rq1_manual_adjusted_table = build_rq1_manual_adjusted_success_table(
        df_all_sample,
        "Full 100-Website Sample",
    )
    print("\nRQ1 manual-adjusted success table:")
    print(rq1_manual_adjusted_table.to_string(index=False))
    summarize_remaining_unreviewed_urls(df_all_sample, "Full 100-Website Sample")
    
    funnel_all = success_funnel(df_all_sample, "Full 100-Website Sample")
    funnel_top10 = success_funnel(df_top_10_cmp_subset, "10 CMP-Provider Subset")

    comparison = pd.DataFrame(
        {
            "dataset": ["Full 100-Website Sample", "10 CMP-Provider Subset"],
            "runs": [len(df_all_sample), len(df_top_10_cmp_subset)],
            "auto_success_rate": [
                stage_pct(funnel_all, "...and counted as auto_success"),
                stage_pct(funnel_top10, "...and counted as auto_success"),
            ],
            "auto_success_with_vision_rate": [
                stage_pct(funnel_all, "...and counted as auto_success_with_vision"),
                stage_pct(funnel_top10, "...and counted as auto_success_with_vision"),
            ],
            "generated_rule_rate": [
                stage_pct(funnel_all, "Rule generated"),
                stage_pct(funnel_top10, "Rule generated"),
            ],
        }
    )

    print("\nRQ1 comparison table:")
    print(
        comparison.to_string(
            index=False,
            formatters={
                "auto_success_rate": lambda x: f"{x:.2f}%",
                "auto_success_with_vision_rate": lambda x: f"{x:.2f}%",
                "generated_rule_rate": lambda x: f"{x:.2f}%",
            },
        )
    )

    sns.set_theme(style="whitegrid")
    plt.figure(figsize=(9, 5))
    plot_df = comparison.melt(
        id_vars=["dataset"],
        value_vars=["auto_success_rate", "auto_success_with_vision_rate", "generated_rule_rate"],
        var_name="metric",
        value_name="value",
    )
    ax = sns.barplot(data=plot_df, x="dataset", y="value", hue="metric", palette="Set2")
    ax.set_ylabel("Rate (%)")
    ax.set_xlabel("")
    ax.set_ylim(0, 100)
    ax.set_title("RQ1: Full sample vs. CMP subset")
    plt.xticks(rotation=15, ha="right")
    plt.tight_layout()
    plt.savefig(RQ1_PLOT_PATH, dpi=250)
    plt.close()
    print(f"\nSaved RQ1 plot to: {RQ1_PLOT_PATH}")
    
    plot_strategy_distribution(df_all_sample, df_top_10_cmp_subset)
    
    analyze_success_reliability(df, all_urls)
    
###################################################
#RQ2

def add_dom_complexity_bucket(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    if "structured_dom_chars" not in df.columns or df.empty:
        df["dom_complexity"] = "UNKNOWN"
        return df

    dom_chars = pd.to_numeric(df["structured_dom_chars"], errors="coerce").fillna(0)
    df["dom_complexity"] = "NO_EXTRACTION"

    valid_mask = dom_chars > 0
    if not valid_mask.any():
        return df

    valid_dom_chars = dom_chars[valid_mask]
    unique_values = valid_dom_chars.nunique()

    if unique_values < 3:
        df.loc[valid_mask, "dom_complexity"] = "MEDIUM"
        return df

    ranked = valid_dom_chars.rank(method="first")
    df.loc[valid_mask, "dom_complexity"] = pd.qcut(
        ranked,
        q=3,
        labels=["LOW", "MEDIUM", "HIGH"],
    )
    return df

def analyze_rq2(df: pd.DataFrame, all_urls: list[str]) -> None:
    """
    RQ2: Does the system's success rate vary by CMP 
    type and DOM complexity?
    """
    print("\nAnalyzing RQ2: Success variation\n")

    df_all_sample = build_subset(df, all_urls).copy()
    
    if df_all_sample.empty:
        return
    
    # df_all_sample["structured_dom_chars_num"] = pd.to_numeric(
    #     df_all_sample["structured_dom_chars"], errors="coerce"
    # )

    # largest_dom_rows = df_all_sample.sort_values(
    #     by="structured_dom_chars_num",
    #     ascending=False,
    # )

    # print("\nRQ2: URLs with the largest structured DOM payloads:")
    # print(
    #     largest_dom_rows[["url", "cmp_type", "structured_dom_chars_num"]]
    #     .head(5)
    #     .to_string(index=False)
    # )
    
    # From RQ2 onward, the single-model Kimi analyses use the manually
    # corrected success label rather than the raw logger flag.
    df_all_sample["auto_success_effective"] = get_effective_success_series(df_all_sample)
    df_all_sample["cmp_type"] = df_all_sample["cmp_type"].fillna("UNDETECTED").replace("", "UNDETECTED")
    df_all_sample = add_dom_complexity_bucket(df_all_sample)
    
    cmp_stats = df_all_sample.groupby("cmp_type")["auto_success_effective"].agg(["mean", "count"]).reset_index()
    
    cmp_stats.rename(columns={"mean": "success_rate", "count": "total_runs"}, inplace=True)
    cmp_stats["success_rate"] = cmp_stats["success_rate"] * 100
    
    cmp_stats = cmp_stats.sort_values(by="total_runs", ascending=False)
    
    print("\nRQ2: Success rate by CMP type (manual correction applied):")
    print(
        cmp_stats.to_string(
            index=False,
            formatters={"success_rate": lambda x: f"{x:.2f}%"}
        )
    )

    complexity_stats = (
        df_all_sample
        .groupby("dom_complexity")
        .agg(
            success_rate=("auto_success_effective", "mean"),
            total_runs=("auto_success_effective", "count"),
            median_dom_chars=("structured_dom_chars", "median"),
            mean_dom_chars=("structured_dom_chars", "mean"),
        )
        .reset_index()
    )
    complexity_stats["success_rate"] = complexity_stats["success_rate"] * 100

    print("\nRQ2: Success rate by DOM complexity bucket (manual correction applied):")
    print(
        complexity_stats.to_string(
            index=False,
            formatters={
                "success_rate": lambda x: f"{x:.2f}%",
                "median_dom_chars": lambda x: f"{x:.0f}",
                "mean_dom_chars": lambda x: f"{x:.0f}",
            },
        )
    )

    outcome_complexity_summary = (
        df_all_sample
        .groupby("auto_success_effective")["structured_dom_chars"]
        .agg(["count", "median", "mean"])
        .reset_index()
    )
    outcome_complexity_summary["auto_success_effective"] = outcome_complexity_summary["auto_success_effective"].map({True: "Success", False: "Failed"})

    print("\nRQ2: Structured DOM size by manually corrected run outcome:")
    print(
        outcome_complexity_summary.to_string(
            index=False,
            formatters={
                "median": lambda x: f"{x:.0f}",
                "mean": lambda x: f"{x:.0f}",
            },
        )
    )

    cmp_complexity_success = (
        df_all_sample
        .pivot_table(
            index="cmp_type",
            columns="dom_complexity",
            values="auto_success_effective",
            aggfunc="mean",
        )
        * 100
    ).round(2)

    cmp_complexity_counts = df_all_sample.pivot_table(
        index="cmp_type",
        columns="dom_complexity",
        values="url",
        aggfunc="count",
    ).fillna(0).astype(int)

    cmp_complexity_counts = cmp_complexity_counts.reindex_like(cmp_complexity_success).fillna(0).astype(int)

    print("\nRQ2: Success rate by CMP type and DOM complexity bucket (manual correction applied):")
    print(cmp_complexity_success.fillna(0).to_string())

    print("\nRQ2: Run counts by CMP type and DOM complexity bucket:")
    print(cmp_complexity_counts.to_string())
    
    sns.set_theme(style="whitegrid")
    plt.figure(figsize=(9, 5))
    
    ax = sns.boxplot(
        data=df_all_sample,
        x="auto_success_effective",
        y="structured_dom_chars",
        palette="Set2",
        hue="auto_success_effective",
        legend=False,
        order=[True, False],
    )
    
    ax.set_title("RQ2: DOM Complexity vs. Manually Corrected Success")
    ax.set_xlabel("Run Outcome")
    ax.set_ylabel("Structured DOM Characters")
    
    ax.set_xticks([0, 1], labels=["Success", "Failed"])
    
    plt.tight_layout()
    plt.savefig(RQ2_PLOT_PATH, dpi=250)
    plt.close()
    
    print(f"\nSaved RQ2 plot to: {RQ2_PLOT_PATH}")

###################################################
#RQ3

def classify_rq3_outcome(row: pd.Series) -> str:
    if to_bool(row.get("auto_success_effective")):
        return "Success"
    if to_bool(row.get("model_aborted")):
        return "Model Aborted"
    if to_bool(row.get("aborted_max_resumes")):
        return "aborted_max_resumes Reached"
    return "Other Failure"

def analyze_rq3(df: pd.DataFrame, all_urls: list[str]) -> None:
    """
    RQ3: How efficient is the system's self-correction loop,
    in terms of iterations required until convergence or abortion?
    """
    print("\nAnalyzing RQ3: Self-correction efficiency\n")

    df_all_sample = build_subset(df, all_urls).copy()
    if df_all_sample.empty:
        return

    #RQ3 also uses the manually corrected success label, so that iteration
    #counts are compared against the best available success/failure judgment.
    df_all_sample["auto_success_effective"] = get_effective_success_series(df_all_sample)
    df_all_sample["model_aborted_bool"] = df_all_sample["model_aborted"].map(to_bool)
    df_all_sample["aborted_max_resumes_bool"] = df_all_sample["aborted_max_resumes"].map(to_bool)
    df_all_sample["rq3_outcome"] = df_all_sample.apply(classify_rq3_outcome, axis=1)

    df_all_sample["test_rule_count"] = pd.to_numeric(df_all_sample["test_rule_count"], errors="coerce").fillna(0)
    df_all_sample["llm_calls"] = pd.to_numeric(df_all_sample["llm_calls"], errors="coerce").fillna(0)
    df_all_sample["analyze_screenshot_count"] = pd.to_numeric(df_all_sample["analyze_screenshot_count"], errors="coerce").fillna(0)
    df_all_sample["human_review_count"] = pd.to_numeric(df_all_sample["human_review_count"], errors="coerce").fillna(0)

    print("RQ3 note: in unattended batch mode, human_review was not resolved by a real person.")
    print("The runner intercepted these interrupts and either resumed automatically or terminated the run after max auto-resumes.\n")

    human_review_runs = df_all_sample[df_all_sample["human_review_count"] > 0]
    max_resume_runs = df_all_sample[df_all_sample["aborted_max_resumes_bool"]]
    print(f"Runs with at least one human_review interrupt: {len(human_review_runs)}/{len(df_all_sample)} ({pct(len(human_review_runs), len(df_all_sample))})")
    print(f"Runs aborted via max auto-resumes: {len(max_resume_runs)}/{len(df_all_sample)} ({pct(len(max_resume_runs), len(df_all_sample))})")
    
    if not human_review_runs.empty:
        print("\nOutcome breakdown among runs with >=1 human_review interrupt:")
        print(human_review_runs["rq3_outcome"].value_counts().to_string())

    other_failure_runs = df_all_sample[df_all_sample["rq3_outcome"] == "Other Failure"]
    print(f"\nRQ3: URLs landing in Other Failure: {len(other_failure_runs)}")
    if other_failure_runs.empty:
        print("No runs found.")
    else:
        print(other_failure_runs["url"].to_string(index=False))

    summary = (
        df_all_sample
        .groupby("rq3_outcome")
        .agg(
            runs=("url", "count"),
            mean_test_rule_count=("test_rule_count", "mean"),
            median_test_rule_count=("test_rule_count", "median"),
            max_test_rule_count=("test_rule_count", "max"),
            mean_llm_calls=("llm_calls", "mean"),
            mean_analyze_screenshot_count=("analyze_screenshot_count", "mean"),
            mean_human_review_count=("human_review_count", "mean"),
        )
        .reset_index()
    )

    print("\nRQ3 summary table by run outcome (manual correction applied):")
    print(
        summary.to_string(
            index=False,
            formatters={
                "mean_test_rule_count": lambda x: f"{x:.2f}",
                "median_test_rule_count": lambda x: f"{x:.2f}",
                "mean_llm_calls": lambda x: f"{x:.2f}",
                "mean_analyze_screenshot_count": lambda x: f"{x:.2f}",
                "mean_human_review_count": lambda x: f"{x:.2f}",
            },
        )
    )

    rule_generated = df_all_sample["final_rule"].notna()
    no_final_test_error = df_all_sample["final_test_error"].map(is_blank)
    stage_clean_test = rule_generated & no_final_test_error
    clean_test_runs = df_all_sample[stage_clean_test].copy()

    print(f"\nRQ3 clean-test stage: {len(clean_test_runs)}/{len(df_all_sample)} runs reached rule_generated + no_final_test_error ({pct(len(clean_test_runs), len(df_all_sample))})")
    if not clean_test_runs.empty:
        clean_stage_summary = (
            clean_test_runs
            .groupby("rq3_outcome")
            .agg(
                runs=("url", "count"),
                mean_test_rule_count=("test_rule_count", "mean"),
                median_test_rule_count=("test_rule_count", "median"),
                mean_analyze_screenshot_count=("analyze_screenshot_count", "mean"),
            )
            .reset_index()
        )
        print("\nRQ3 summary among clean-test-stage runs (manual correction applied):")
        print(
            clean_stage_summary.to_string(
                index=False,
                formatters={
                    "mean_test_rule_count": lambda x: f"{x:.2f}",
                    "median_test_rule_count": lambda x: f"{x:.2f}",
                    "mean_analyze_screenshot_count": lambda x: f"{x:.2f}",
                },
            )
        )

    outcome_order = ["Success", "Model Aborted", "aborted_max_resumes Reached", "Other Failure"]
    plot_df = df_all_sample[df_all_sample["rq3_outcome"].isin(outcome_order)].copy()

    sns.set_theme(style="whitegrid")
    plt.figure(figsize=(9, 5))
    ax = sns.boxplot(
        data=plot_df,
        x="rq3_outcome",
        y="test_rule_count",
        order=outcome_order,
        palette="Set2",
        hue="rq3_outcome",
        legend=False
    )
    sns.stripplot(
        data=plot_df,
        x="rq3_outcome",
        y="test_rule_count",
        order=outcome_order,
        color="black",
        alpha=0.45,
        size=4,
        ax=ax,
    )
    ax.set_title("RQ3: Self-correction iterations until outcome")
    ax.set_xlabel("Run outcome")
    ax.set_ylabel("test_rule_count")
    plt.xticks(rotation=15, ha="right")
    plt.tight_layout()
    plt.savefig(RQ3_PLOT_PATH, dpi=250)
    plt.close()

    print(f"\nSaved RQ3 plot to: {RQ3_PLOT_PATH}")

###################################################
#RQ4 & RQ6

def analyze_rq4_significance(df: pd.DataFrame, all_urls: list[str]) -> None:
    """
    Tests whether the observed auto_success rate differences across the three
    backbones are statistically significant, rather than plausibly due to
    random sampling noise. Two steps:
    1. An "omnibus" chi-square test across all three models at once, answering
        only "is there SOME difference among the three?" without saying which.
    2. Bonferroni-corrected pairwise two-proportion z-tests, each comparing
        exactly two models, to pin down which specific pairs actually differ.
    """

    #RQ4 intentionally stays on the raw automated success metric
    results = {}
    for model_string, label in MODEL_CONFIGS:
        subset = build_subset(df, all_urls, model=model_string)
        raw_auto_success = subset["auto_success"].map(to_bool)
        results[label] = (int(raw_auto_success.sum()), len(subset))

    contingency = [[succ, total - succ] for succ, total in results.values()]
    chi2, p_omnibus, dof, _ = chi2_contingency(contingency)
    #chi2: the test statistic itself (larger = more deviation from "no difference")
    #dof: degrees of freedom (here: (3 models - 1) * (2 outcomes - 1) = 2)
    #p_omnibus: the actual p-value
    print(f"\nOmnibus chi-square test across all three models: chi2={chi2:.2f}, p={p_omnibus:.4f}")

    labels = list(results.keys())
    n_comparisons = 3

    #Bonferroni correction: running 3 separate tests at the usual alpha=0.05
    #threshold would let false positives slip through more easily than
    #intended. Dividing alpha by the number of
    #comparisons keeps the false-positive risk across all three
    #tests at roughly 5%, at the cost of requiring a smaller p-value per
    #individual test to call it "significant".
    alpha_corrected = 0.05 / n_comparisons
    print(f"\nPairwise comparisons (Bonferroni-corrected alpha={alpha_corrected:.4f}):")

    for i in range(len(labels)):
        for j in range(i + 1, len(labels)):
            label_a, label_b = labels[i], labels[j]
            succ_a, n_a = results[label_a]
            succ_b, n_b = results[label_b]

            #stat: the z-statistic (larger absolute value = bigger gap relative to noise)
            #p: the resulting p-value for this specific pair
            stat, p = proportions_ztest([succ_a, succ_b], [n_a, n_b])

            sig = "significant" if p < alpha_corrected else "not significant"
            print(f"{label_a} ({succ_a}/{n_a}) vs {label_b} ({succ_b}/{n_b}): z={stat:.2f}, p={p:.4f} ({sig})")

def analyze_rq4_rq6(df: pd.DataFrame, all_urls: list[str], all_urls_110: list[str]) -> None:
    """
    RQ4: How does performance on this automation task differ across LLM backbones?
    Kimi K2.6 is the primary backbone used throughout the rest of the results
    (Sections 7.2/7.3); this section compares central metrics against both
    Gemma 4 configurations on the identical full 100-website sample.

    RQ6: What is the resource demand of the agentic 
    system?
    
    Token usage is not available in the structured run logs. Final per-model
    totals reported in the thesis were instead compiled manually from LangSmith
    (Gemma configurations) and timestamped LiteLLM proxy metadata (Kimi K2.6),
    as described in Section subsec:dataCollection of the thesis, and are not computed by
    this function.

    Important: unlike RQ2/RQ3/RQ5, this comparison intentionally stays on raw
    automated success metrics. Manual verification exists only for the Kimi
    sample and must therefore not be folded into a supposedly fair
    cross-backbone comparison.
    """
    print("\nAnalyzing RQ4: Cross-model comparison\n")

    rows = []
    strategy_frames = []
    for model_string, label in MODEL_CONFIGS:
        subset = build_subset(df, all_urls, model=model_string)
        total = len(subset)
        if total == 0:
            print(f"WARNING: no runs found for {label} ({model_string}) - skipping.")
            continue
        if total != len(all_urls):
            print(f"NOTE: {label} has {total}/{len(all_urls)} runs - not a full 1:1 match with the URL sample.")

        raw_auto_success = subset["auto_success"].map(to_bool)
        raw_auto_success_with_vision = get_auto_success_with_vision_series(subset)
        
        model_aborted = subset["model_aborted"].map(to_bool)
        human_review_count = pd.to_numeric(subset["human_review_count"], errors="coerce").fillna(0)
        test_rule_count = pd.to_numeric(subset["test_rule_count"], errors="coerce").fillna(0)
        duration = pd.to_numeric(subset["duration_seconds"], errors="coerce")
        rule_generated = subset["final_rule"].notna()
        no_final_test_error = subset["final_test_error"].map(is_blank)
        clean_test_stage_rate = (rule_generated & no_final_test_error).mean() * 100

        rows.append({
            "model": label,
            "runs": total,
            "auto_success_rate": raw_auto_success.mean() * 100,
            "auto_success_rate_with_vision": raw_auto_success_with_vision.mean() * 100,
            "clean_test_stage_rate": clean_test_stage_rate,
            "median_test_rule_count": test_rule_count.median(),
            "mean_human_review_count": human_review_count.mean(),
            "model_aborted_rate": model_aborted.mean() * 100,
            "mean_duration_seconds": duration.mean(),
            "median_duration_seconds": duration.median(),
        })
        strategy_frames.append(strategy_shares(subset, label))

    comparison = pd.DataFrame(rows)
    if comparison.empty:
        print("No model data found - check model_used values against MODEL_CONFIGS.")
        return

    print("RQ4 comparison table (identical 100-website sample per model):")
    print(
        comparison.to_string(
            index=False,
            formatters={
                "auto_success_rate": lambda x: f"{x:.2f}%",
                "auto_success_rate_with_vision": lambda x: f"{x:.2f}%",
                "clean_test_stage_rate": lambda x: f"{x:.2f}%",
                "median_test_rule_count": lambda x: f"{x:.2f}",
                "mean_human_review_count": lambda x: f"{x:.2f}",
                "model_aborted_rate": lambda x: f"{x:.2f}%",
                "mean_duration_seconds": lambda x: f"{x:.1f}",
                "median_duration_seconds": lambda x: f"{x:.1f}",
            },
        )
    )
    
    analyze_rq4_significance(df, all_urls)
    
    #Quick Check: llm_calls per model
    print(f"\nQuick llm_calls comparison:")
    for model_string, label in MODEL_CONFIGS:
        subset = build_subset(df, all_urls_110, model=model_string)
        llm_calls = pd.to_numeric(subset["llm_calls"], errors="coerce")
        print(f"{label}: mean_llm_calls={llm_calls.mean():.2f}, median={llm_calls.median():.1f}")

    sns.set_theme(style="whitegrid")
    plt.figure(figsize=(9, 5))
    plot_df = comparison.melt(
        id_vars=["model"],
        value_vars=["auto_success_rate", "auto_success_rate_with_vision", "model_aborted_rate"],
        var_name="metric", value_name="value",
    )
    ax = sns.barplot(data=plot_df, x="model", y="value", hue="metric")
    ax.set_ylabel("Rate (%)")
    ax.set_xlabel("")
    ax.set_ylim(0, 100)
    ax.set_title("RQ4: Cross-model comparison")
    plt.xticks(rotation=10, ha="right")
    plt.tight_layout()
    plt.savefig(RQ4_PLOT_PATH, dpi=250)
    plt.close()
    print(f"\nSaved RQ4 plot to: {RQ4_PLOT_PATH}")

    if strategy_frames:
        combined_strategy = pd.concat(strategy_frames, ignore_index=True)
        combined_strategy = apply_strategy_display_labels(combined_strategy)
        strategy_table = combined_strategy.pivot(
            index="dataset",
            columns="strategy_type",
            values="share",
        ).fillna(0.0)
        print("\nRQ4: strategy_type distribution by model (% of runs):")
        print(
            strategy_table.to_string(
                formatters={column: lambda x: f"{x:.2f}%" for column in strategy_table.columns}
            )
        )
        plot_strategy_bars(combined_strategy, RQ4_STRATEGY_PLOT_PATH, "RQ4: strategy_type distribution by model")

###################################################
#RQ5

#Manual overrides for primary_error_code where the priority-based derivation
#picks a downstream symptom over the actual, independently verified root cause.
#Kept as an explicit, minimal override rather than changing the general
#priority logic, since the existing final_test_error-first ordering is
#correct for the remaining failed runs.
MANUAL_ERROR_CODE_OVERRIDES = {
    "https://www.tumblr.com": "EXTRACT_DOM_TIMEOUT",
    "https://www.bol.com": "EXTRACT_DOM_EMPTY_RESULT",
    #wrong settings button selected during extraction (fallback matched
    #"MORE" instead of the correctly identified "Settings" hit), leading
    #the agent into an unrelated subpage
    "https://www.howtogeek.com": "EXTRACT_DOM_WRONG_SETTINGS_BUTTON",
    #manual verification (Section RQ1Results) confirmed this as a
    #pay-or-consent case; the redirect to payment only manifests after the
    #interface is already resolved, so it could not trigger the agent's
    #own abort mechanism and was not detected as such automatically
    "https://www.leboncoin.fr": "PAY_OR_CONSENT_DEAD_END",
    #same underlying extraction bug as howtogeek.com: oversized DOM was a
    #contributing factor, but the root cause is that interactive banner
    #elements (e.g. Reject All) were never extracted due to a wrong
    #settings-button selection, not the DOM size itself
    "https://store.steampowered.com": "EXTRACT_DOM_WRONG_SETTINGS_BUTTON",
    #website hosts two distinct banner containers and my extraction script
    #only extracted information from the first, giving the LLM no information
    #about the banner the user initially sees
    "https://www.makeuseof.com": "EXTRACT_DOM_WRONG_SETTINGS_BUTTON",
}


def apply_manual_error_code_overrides(df: pd.DataFrame) -> pd.Series:
    normalized_overrides = {
        normalize_url_for_matching(url): code
        for url, code in MANUAL_ERROR_CODE_OVERRIDES.items()
    }
    normalized_row_urls = df["url"].map(normalize_url_for_matching)
    override_series = normalized_row_urls.map(normalized_overrides)
    return df["primary_error_code"].where(override_series.isna(), override_series)

def normalize_error(value) -> str:
    text = as_clean_str(value)

    if text == "":
        return "NO_ERROR"
    if "Missing argument for test_rule: url required" in text: #test_rule.js
        return "TEST_RULE_ARGUMENT_ERROR"
    if "Missing argument for analyze_screenshot: url required" in text: #analyze_screenshot.js
        return "ANALYZE_SCREENSHOT_ARGUMENT_ERROR"
    if "Puppeteer Error in analyze_screenshot" in text: #in analyze_screenshot.js
        return "PUPPETEER_ERROR_ANALYZE_SCREENSHOT"
    #These two test_rule-specific Puppeteer crashes are kept as separate codes
    #instead of being collapsed into the generic test_rule Puppeteer bucket.
    #Note: manual inspection during RQ1 verification recovered five prior
    #occurrences of this text as false negatives (Section~RQ1Results); those
    #runs are excluded from RQ5's failed-run population via auto_success_effective.
    #Any remaining occurrence in the failed population (e.g. amazon.de) instead
    #reflects a genuine failure where the agent did not recognize a navigation-
    #triggering settings button as requiring an abort or alternate strategy.
    if text == "Puppeteer Error in test_rule: Protocol error (Runtime.callFunctionOn): Execution context was destroyed.":
        return "PUPPETEER_ERROR_TEST_RULE_EXECUTION_CONTEXT_DESTROYED_PROTOCOL"
    if text == "Puppeteer Error in test_rule: Execution context was destroyed, most likely because of a navigation.":
        return "PUPPETEER_ERROR_TEST_RULE_EXECUTION_CONTEXT_DESTROYED_NAVIGATION"
    if "Puppeteer Error in test_rule" in text: #test_rule.js
        return "PUPPETEER_ERROR_TEST_RULE"
    if "Invalid JSON from Python in test_rule" in text: #test_rule.js
        return "INVALID_JSON_FROM_PYTHON"
    if "Execution error in Consent-O-Matic" in text: #test_rule.js
        return "CONSENT_ENGINE_EXECUTION_ERROR"
    if "Banner not found or matchers failed" in text: #test_rule.js
        return "MATCHER_FAILURE_BANNER_NOT_FOUND"
    if "Invalid CMP" in text: #test_rule.js
        return "INVALID_CMP_FOR_TEST"
    if "Timeout after 300s" in text: #test_rule.js
        return "TEST_RULE_TIMEOUT"
    if "No output received from the testing environment" in text: #test_rule.js
        return "TEST_RULE_FAILURE"
    if "Selector Failed: WAITCSS_TIMEOUT" in text: #test_rule.js
        return "SELECTOR_WAITCSS_TIMEOUT"
    if "Selector Failed: ACTION_TARGET_NOT_FOUND" in text: #test_rule.js
        return "TEST_RULE_TARGET_NOT_FOUND"
    if "CRITICAL ERROR: You forgot the required 'json_string' or 'url' argument in your tool call." in text: #test_rule.js
        return "TEST_RULE_ARGUMENT_ERROR"
    if "No CMP detected" in text: #test_rule.js
        return "DETECTOR_NO_CMP_DETECTED"
    if "Found multiple CMPS's" in text: #test_rule.js
        return "MULTIPLE_CMPS"
    if "test_rule tool returned invalid JSON" in text: #test_rule.js
        return "MALFORMED_JSON_BY_TEST_RULE"
    if "Invalid JSON in rule tags:" in text: #rule_output_node
        return "RULE_OUTPUT_INVALID_JSON"
    if "Invalid JSON: Expecting" in text:
        return "MALFORMED_JSON"
    if "No rule found in agent message" in text: #rule_output_node
        return "NO_RULE_FOUND_FOR_OUTPUT"
    if text == "ABORTED: max auto-resumes reached":
        return "MAX_AUTO_RESUMES_ABORT"
    if text.startswith("NO_BANNER_DETECTED"):
        return "NO_BANNER_DETECTED"
    if text.startswith("PAY_OR_CONSENT_DEAD_END"):
        return "PAY_OR_CONSENT_DEAD_END"
    if text.startswith("SOURCEPOINT_FIRST_LAYER_NO_REJECT"):
        return "SOURCEPOINT_FIRST_LAYER_NO_REJECT"
    if "extract_dom.js timed out" in text:
        return "EXTRACT_DOM_TIMEOUT"
    if "extractStructuredDom critical execution failure" in text:
        return "EXTRACT_DOM_CRITICAL_EXECUTION_FAILURE"
    if "extraction_node: extract_dom.js returned invalid JSON:" in text:
        return "EXTRACT_DOM_INVALID_JSON_OUTPUT"
    if "extraction_node: extract_dom.js returned empty result" in text:
        return "EXTRACT_DOM_EMPTY_RESULT"
    if "ContextWindowExceededError" in text:
        return "MODEL_CONTEXT_WINDOW_EXCEEDED"
    if "overall timeout reached (1800s)" in text:
        return "OVERALL_TIMEOUT_REACHED"

    return "OTHER_ERROR"

#Maps the normalized failure *code* to a higher-level category matching the system's
#architectural layers, for a readable Stage 2 summary in the thesis text.
FAILURE_CATEGORY_MAP = {
    #Model-level strategic abort
    "SOURCEPOINT_FIRST_LAYER_NO_REJECT": "ARCHITECTURAL_LIMITATION_SOURCEPOINT",
    "PAY_OR_CONSENT_DEAD_END": "PAY_OR_CONSENT_DEAD_END",
    "NO_BANNER_DETECTED": "NO_CONSENT_INTERFACE_DETECTED",

    #Batch/runner infrastructure
    "MAX_AUTO_RESUMES_ABORT": "RUNNER_ESCALATION_EXHAUSTED",

    #Consent-engine/live-test layer: detection, action & matching
    "CONSENT_ENGINE_EXECUTION_ERROR": "DETECTION_OR_ACTION_MATCHER_FAILURE",
    "MATCHER_FAILURE_BANNER_NOT_FOUND": "DETECTION_OR_ACTION_MATCHER_FAILURE",
    "DETECTOR_NO_CMP_DETECTED": "DETECTION_OR_ACTION_MATCHER_FAILURE",
    "MULTIPLE_CMPS": "DETECTION_OR_ACTION_MATCHER_FAILURE",
    "INVALID_CMP_FOR_TEST": "DETECTION_OR_ACTION_MATCHER_FAILURE",
    "TEST_RULE_TARGET_NOT_FOUND": "DETECTION_OR_ACTION_MATCHER_FAILURE",
    "SELECTOR_WAITCSS_TIMEOUT": "DETECTION_OR_ACTION_MATCHER_FAILURE",

    #Test-tool/bridging infrastructure
    "TEST_RULE_TIMEOUT": "INFRASTRUCTURE_FAILURE",
    "TEST_RULE_FAILURE": "INFRASTRUCTURE_FAILURE",
    "MALFORMED_JSON_BY_TEST_RULE": "INFRASTRUCTURE_FAILURE",
    "INVALID_JSON_FROM_PYTHON": "INFRASTRUCTURE_FAILURE",
    "PUPPETEER_ERROR_TEST_RULE": "INFRASTRUCTURE_FAILURE",
    "PUPPETEER_ERROR_ANALYZE_SCREENSHOT": "INFRASTRUCTURE_FAILURE",
    "OVERALL_TIMEOUT_REACHED": "INFRASTRUCTURE_FAILURE",

    #DOM extraction layer
    "EXTRACT_DOM_TIMEOUT": "EXTRACTION_FAILURE",
    "EXTRACT_DOM_CRITICAL_EXECUTION_FAILURE": "EXTRACTION_FAILURE",
    "EXTRACT_DOM_INVALID_JSON_OUTPUT": "EXTRACTION_FAILURE",
    "EXTRACT_DOM_EMPTY_RESULT": "EXTRACTION_FAILURE",
    "EXTRACT_DOM_WRONG_SETTINGS_BUTTON": "EXTRACTION_FAILURE",
    
    #Context Window of the LLM
    "MODEL_CONTEXT_WINDOW_EXCEEDED": "PAYLOAD_SIZE_LIMITATION",

    # Model-output, tool calling or rule-generation layer
    "RULE_OUTPUT_INVALID_JSON": "MODEL_CALLING_OR_OUTPUT_FAILURE",
    "NO_RULE_FOUND_FOR_OUTPUT": "MODEL_CALLING_OR_OUTPUT_FAILURE",
    "NO_FINAL_RULE_RECORDED": "MODEL_CALLING_OR_OUTPUT_FAILURE",
    "ENGINE_NOT_HANDLED_NO_DETAIL": "MODEL_CALLING_OR_OUTPUT_FAILURE",
    "BANNER_NOT_DISMISSED_NO_DETAIL": "MODEL_CALLING_OR_OUTPUT_FAILURE",
    "TEST_RULE_ARGUMENT_ERROR": "MODEL_CALLING_OR_OUTPUT_FAILURE",
    "ANALYZE_SCREENSHOT_ARGUMENT_ERROR": "MODEL_CALLING_OR_OUTPUT_FAILURE",
    "MALFORMED_JSON": "MODEL_CALLING_OR_OUTPUT_FAILURE",
    #technically they are "INFRASTRUCTURE_FAILURE" at first glance, but all cases relevant for this specific
    #evaluation (amazon.de) are actually an issue caused by the Model
    "PUPPETEER_ERROR_TEST_RULE_EXECUTION_CONTEXT_DESTROYED_PROTOCOL": "MODEL_CALLING_OR_OUTPUT_FAILURE",
    "PUPPETEER_ERROR_TEST_RULE_EXECUTION_CONTEXT_DESTROYED_NAVIGATION": "MODEL_CALLING_OR_OUTPUT_FAILURE",

    #Unresolved/needs manual review
    "OTHER_ERROR": "UNCATEGORIZED_ERROR_TEXT",
}

#Presentation-only labels for thesis figures/tables. Keeps FAILURE_CATEGORY_MAP
#and all internal string comparisons (e.g. the UNCATEGORIZED_ERROR_TEXT check)
#working on the stable code-style category names; this only affects display.
FAILURE_CATEGORY_DISPLAY_LABELS = {
    "ARCHITECTURAL_LIMITATION_SOURCEPOINT": "Sourcepoint Architectural Limitation",
    "PAY_OR_CONSENT_DEAD_END": "Pay-or-Consent Dead End",
    "NO_CONSENT_INTERFACE_DETECTED": "No Consent Interface Detected",
    "RUNNER_ESCALATION_EXHAUSTED": "Human-Review Auto-Resume Limit Reached",
    "DETECTION_OR_ACTION_MATCHER_FAILURE": "CMP Detection or Selector Failure",
    "INFRASTRUCTURE_FAILURE": "Infrastructure Failure",
    "EXTRACTION_FAILURE": "DOM Extraction Failure",
    "MODEL_CALLING_OR_OUTPUT_FAILURE": "Model Output or Tool-Calling Failure",
    "UNCATEGORIZED_ERROR_TEXT": "Unclassified Failure",
    "PAYLOAD_SIZE_LIMITATION": "Context Limitation"
}

def derive_primary_error_code(row: pd.Series) -> str:
    abort_code = as_clean_str(row.get("abort_code"))
    normalized_final_test_error = row.get("normalized_final_test_error", "NO_ERROR")
    normalized_last_error = row.get("normalized_last_error", "NO_ERROR")

    if abort_code:
        return abort_code
    if normalized_final_test_error != "NO_ERROR":
        return normalized_final_test_error
    if normalized_last_error != "NO_ERROR":
        return normalized_last_error
    if pd.isna(row.get("final_rule")):
        return "NO_FINAL_RULE_RECORDED"
    
    handled_value = row.get("handled")
    if pd.notna(handled_value) and not to_bool(handled_value):
        return "ENGINE_NOT_HANDLED_NO_DETAIL"

    banner_dismissed_value = row.get("banner_dismissed")
    if pd.notna(banner_dismissed_value) and not to_bool(banner_dismissed_value):
        return "BANNER_NOT_DISMISSED_NO_DETAIL"
    
    return "OTHER_ERROR"

def analyze_rq5(df: pd.DataFrame, all_urls: list[str]) -> None:
    """
    RQ5: What error types and architectural limitations prevent successful rule generation?
    Stage 1 focuses on raw error-signal aggregation and coverage checks over all
    failed runs. The success/failure split itself, however, uses the manually
    corrected Kimi outcome label, just like RQ2 and RQ3.
    """
    print("\nAnalyzing RQ5: Error types and failure signals\n")

    df_all_sample = build_subset(df, all_urls).copy()
    if df_all_sample.empty:
        return

    # RQ5 analyzes error causes among runs that are still failures after manual
    # verification, not merely among runs flagged unsuccessful by the raw
    # logger metric.
    df_all_sample["auto_success_effective"] = get_effective_success_series(df_all_sample)
    failed_runs = df_all_sample[~df_all_sample["auto_success_effective"]].copy()
    if failed_runs.empty:
        print("No failed runs found.")
        return

    print(
        f"Effectively failed runs in primary sample after manual success/failure correction: "
        f"{len(failed_runs)}/{len(df_all_sample)} ({pct(len(failed_runs), len(df_all_sample))})"
    )

    failed_runs["raw_abort_code_filled"] = failed_runs["abort_code"].apply(
        lambda value: as_clean_str(value) if as_clean_str(value) else "NO_ABORT_CODE"
    )
    failed_runs["raw_final_test_error_filled"] = failed_runs["final_test_error"].apply(
        lambda value: as_clean_str(value) if as_clean_str(value) else "NO_ERROR"
    )
    failed_runs["raw_last_error_filled"] = failed_runs["last_error"].apply(
        lambda value: as_clean_str(value) if as_clean_str(value) else "NO_ERROR"
    )

    print("\nRQ5 Stage 1: raw abort_code counts (blank filled as NO_ABORT_CODE):")
    raw_abort_counts = failed_runs["raw_abort_code_filled"].value_counts()
    print(raw_abort_counts.to_string())
    print(f"Coverage: {int(raw_abort_counts.sum())}/{len(failed_runs)} failed runs")

    print("\nRQ5 Stage 1: raw final_test_error counts (blank filled as NO_ERROR):")
    raw_final_error_counts = failed_runs["raw_final_test_error_filled"].value_counts()
    print(raw_final_error_counts.to_string())
    print(f"Coverage: {int(raw_final_error_counts.sum())}/{len(failed_runs)} failed runs")

    print("\nRQ5 Stage 1: raw last_error counts (blank filled as NO_ERROR):")
    raw_last_error_counts = failed_runs["raw_last_error_filled"].value_counts()
    # print(raw_last_error_counts.to_string())
    print(f"Coverage: {int(raw_last_error_counts.sum())}/{len(failed_runs)} failed runs")

    harness_bug_pattern = "Execution context was destroyed"
    harness_bug_suspects = failed_runs[
        failed_runs["final_test_error"].fillna("").astype(str).str.contains(harness_bug_pattern, regex=False)
        | failed_runs["last_error"].fillna("").astype(str).str.contains(harness_bug_pattern, regex=False)
    ]
    print(f"\nRQ5 Stage 1: {len(harness_bug_suspects)} runs show the exact harness error signature '{harness_bug_pattern}':")
    if harness_bug_suspects.empty:
        print("No runs found.")
    else:
        print(harness_bug_suspects["url"].to_string(index=False))

    #Stage 2

    failed_runs["normalized_abort_code"] = failed_runs["raw_abort_code_filled"]
    failed_runs["normalized_final_test_error"] = failed_runs["final_test_error"].apply(normalize_error)
    failed_runs["normalized_last_error"] = failed_runs["last_error"].apply(normalize_error)

    print("\nRQ5 Stage 2: normalized final_test_error counts:")
    print(failed_runs["normalized_final_test_error"].value_counts().to_string())

    print("\nRQ5 Stage 2: normalized last_error counts:")
    print(failed_runs["normalized_last_error"].value_counts().to_string())

    failed_runs["primary_error_code"] = failed_runs.apply(derive_primary_error_code, axis=1)
    failed_runs["primary_error_code"] = apply_manual_error_code_overrides(failed_runs)
    failed_runs["failure_category"] = failed_runs["primary_error_code"].map(FAILURE_CATEGORY_MAP).fillna("UNCATEGORIZED_ERROR_TEXT")

    primary_code_counts = failed_runs["primary_error_code"].value_counts()
    # print("\nRQ5 Stage 2: primary normalized error-code counts (exactly one code per failed run):")
    # print(primary_code_counts.to_string())

    category_counts = failed_runs["failure_category"].value_counts()
    print("\nRQ5 Stage 2: mapped failure-category counts:")
    print(category_counts.to_string())

    covered_failures = int(primary_code_counts.sum())
    print(f"\nRQ5 Stage 2 coverage check: {covered_failures}/{len(failed_runs)} failed runs received a primary normalized error code.")

    unresolved = failed_runs[failed_runs["failure_category"] == "UNCATEGORIZED_ERROR_TEXT"]
    if not unresolved.empty:
        print("\nURLs currently landing in UNCATEGORIZED_ERROR_TEXT:")
        print(unresolved[["url", "primary_error_code", "last_error", "final_test_error"]].to_string(index=False))

    # print("\nRQ5 Stage 3: full URL-to-category mapping for verification:")
    # print(
    #     failed_runs[["url", "primary_error_code", "failure_category"]]
    #     .sort_values("failure_category")
    #     .to_string(index=False)
    # )
    
    sns.set_theme(style="whitegrid")
    plt.figure(figsize=(9, 5))
    plot_counts = category_counts.reset_index()
    plot_counts.columns = ["failure_category", "count"]
    plot_counts["failure_category"] = plot_counts["failure_category"].map(FAILURE_CATEGORY_DISPLAY_LABELS).fillna(plot_counts["failure_category"])
    ax = sns.barplot(
        data=plot_counts,
        x="count",
        y="failure_category",
        palette="Set2",
        hue="failure_category",
        legend=False
    )
    ax.set_title("RQ5: Failure categories among manually corrected unsuccessful runs")
    ax.set_xlabel("Number of failed runs")
    ax.set_ylabel("")
    plt.tight_layout()
    plt.savefig(RQ5_PLOT_PATH, dpi=250)
    plt.close()

    print(f"\nSaved RQ5 plot to: {RQ5_PLOT_PATH}")
    
if __name__ == "__main__":
    df = load_results_csv()
    if df is not None:
        print("\nAvailable columns in the DataFrame:")
        print(df.columns.tolist())
        
        all_urls = load_url_list(ALL_URLS_PATH)
        top_10_cmp_urls = load_url_list(TOP_10_CMP_URLS_PATH)
        all_urls_110 = load_url_list(ALL_URLS_110_PATH)
        
        df_kimi = df[df["model_used"].astype(str).str.strip() == PRIMARY_MODEL].copy()
        analyze_rq1(df_kimi, all_urls, top_10_cmp_urls)
        analyze_rq2(df_kimi, all_urls)
        analyze_rq3(df_kimi, all_urls)
        analyze_rq4_rq6(df, all_urls, all_urls_110)
        analyze_rq5(df_kimi, all_urls)
