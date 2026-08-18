from __future__ import annotations

from pathlib import Path

import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns

ROOT_DIR = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT_DIR / "data" / "logs" / "evaluation_summary.csv"
ALL_URLS_PATH = ROOT_DIR / "evaluation" / "reported_urls.txt"
TOP_10_CMP_URLS_PATH = ROOT_DIR / "evaluation" / "top_10_cmp_homepages.txt"
RQ1_PLOT_PATH = ROOT_DIR / "evaluation" / "rq1_summary.png"
RQ2_PLOT_PATH = ROOT_DIR / "evaluation" / "rq2_dom_complexity.png"

def load_results_csv() -> pd.DataFrame | None:
    if not CSV_PATH.exists():
        print(f"Error during evaluation: The file {CSV_PATH} could not be found!")
        return None

    df = pd.read_csv(CSV_PATH)
    print(f"{len(df)} runs were loaded!")
    return df

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

def summarize_subset(df: pd.DataFrame, label: str) -> None:
    total_count = len(df)
    print(f"\n--- {label} ({total_count} runs) ---")

    if total_count == 0:
        print("No rows found for this subset.")
        return

    auto_success = df["auto_success"].map(to_bool)
    success_count = int(auto_success.sum())
    print(f"Automated success rate: {success_count}/{total_count} ({pct(success_count, total_count)})")

    if "final_rule" in df.columns:
        rules_generated_count = int(df["final_rule"].notna().sum())
        print(f"Runs with a generated JSON rule: {rules_generated_count}/{total_count} ({pct(rules_generated_count, total_count)})")

    if "strategy_type" in df.columns:
        print("\nStrategy counts:")
        print(df["strategy_type"].fillna("UNKNOWN").value_counts().to_string())

        print("\nStrategy counts among successful runs:")
        successful_runs = df[auto_success]
        if not successful_runs.empty:
            print(successful_runs["strategy_type"].fillna("UNKNOWN").value_counts().to_string())
        else:
            print("No successful runs found.")

def build_subset(df: pd.DataFrame, url_list: list[str]) -> pd.DataFrame:
    return df[df["url"].isin(url_list)].copy()

def analyze_rq1(df: pd.DataFrame, all_urls: str, top_10_cmp_urls: str) -> None:
    """
    RQ1: What functional solution quality do the autonomously generated rules exhibit,
    as measured by the automated success rate across the full 100-website sample,
    complemented by the CMP-provider subset as a separate comparison group?
    """

    print("Analyzing RQ1: Functional Solution Quality\n")

    df_all_sample = build_subset(df, all_urls)
    df_top_10_cmp_subset = build_subset(df, top_10_cmp_urls)

    summarize_subset(df_all_sample, "Full 100-Website Sample")

    if len(df_all_sample) != len(all_urls):
        missing_urls = sorted(set(all_urls) - set(df_all_sample["url"].tolist()))
        if missing_urls:
            print(f"\nMissing URLs from 100-sample result set: {len(missing_urls)}")
            for url in missing_urls[:10]:
                print(f"  - {url}")

    summarize_subset(df_top_10_cmp_subset, "10 CMP-Provider Subset")

    all_sample_generated_rule_rate = 0.0
    if "final_rule" in df_all_sample.columns and not df_all_sample.empty:
        all_sample_generated_rule_rate = df_all_sample["final_rule"].notna().mean() * 100
        
    top_10_sample_generated_rule_rate = 0.0
    if "final_rule" in df_top_10_cmp_subset.columns and not df_top_10_cmp_subset.empty:
        top_10_sample_generated_rule_rate = df_top_10_cmp_subset["final_rule"].notna().mean() * 100

    comparison = pd.DataFrame(
        {
            "dataset": ["Full 100-Website Sample", "10 CMP-Provider Subset"],
            "runs": [len(df_all_sample), len(df_top_10_cmp_subset)],
            "auto_success_rate": [
                df_all_sample["auto_success"].map(to_bool).mean() * 100 if not df_all_sample.empty else 0.0,
                df_top_10_cmp_subset["auto_success"].map(to_bool).mean() * 100 if not df_top_10_cmp_subset.empty else 0.0,
            ],
            "generated_rule_rate": [
                all_sample_generated_rule_rate,
                top_10_sample_generated_rule_rate,
            ],
        }
    )

    print("\nRQ1 comparison table:")
    print(
        comparison.to_string(
            index=False,
            formatters={
                "auto_success_rate": lambda x: f"{x:.2f}%",
                "generated_rule_rate": lambda x: f"{x:.2f}%",
            },
        )
    )

    sns.set_theme(style="whitegrid")
    plt.figure(figsize=(9, 5))
    plot_df = comparison.melt(
        id_vars=["dataset"],
        value_vars=["auto_success_rate", "generated_rule_rate"],
        var_name="metric",
        value_name="value",
    )
    ax = sns.barplot(data=plot_df, x="dataset", y="value", hue="metric")
    ax.set_ylabel("Rate (%)")
    ax.set_xlabel("")
    ax.set_ylim(0, 100)
    ax.set_title("RQ1: Full sample vs. CMP subset")
    plt.xticks(rotation=15, ha="right")
    plt.tight_layout()
    plt.savefig(RQ1_PLOT_PATH, dpi=200)
    plt.close()
    print(f"\nSaved RQ1 plot to: {RQ1_PLOT_PATH}")
    
def analyze_rq2(df: pd.DataFrame, all_urls: str) -> None:
    print("Analyzing RQ2: Success variation\n")

    df_all_sample = build_subset(df, all_urls).copy()
    
    if df_all_sample.empty:
        return
    
    df_all_sample["auto_success_bool"] = df_all_sample["auto_success"].map(to_bool)
    
    cmp_stats = df_all_sample.groupby("cmp_type")["auto_success_bool"].agg(["mean", "count"]).reset_index()
    
    cmp_stats.rename(columns={"mean": "success_rate", "count": "total_runs"}, inplace=True)
    cmp_stats["success_rate"] = cmp_stats["success_rate"] * 100
    
    cmp_stats = cmp_stats.sort_values(by="total_runs", ascending=False)
    
    print("RQ2: Success rate by CMP type:")
    print(
        cmp_stats.to_string(
            index=False,
            formatters={"success_rate": lambda x: f"{x:.2f}%"}
        )
    )
    
    sns.set_theme(style="whitegrid")
    plt.figure(figsize=(8, 6))
    
    ax = sns.boxplot(
        data=df_all_sample,
        x="auto_success_bool",
        y="structured_dom_chars",
        palette="Set2",
    )
    
    ax.set_title("RQ2: DOM Complexity vs. Automated Success")
    ax.set_xlabel("Run Outcome")
    ax.set_ylabel("Structured DOM Characters")
    
    ax.set_xticklabels(["Failed", "Success"])
    
    plt.tight_layout()
    plt.savefig(RQ2_PLOT_PATH, dpi=400)
    plt.close()
    
    print(f"\nSaved RQ2 plot to: {RQ2_PLOT_PATH}")

if __name__ == "__main__":
    df = load_results_csv()
    if df is not None:
        print("\nAvailable columns in the DataFrame:")
        print(df.columns.tolist())
        
        all_urls = load_url_list(ALL_URLS_PATH)
        top_10_cmp_urls = load_url_list(TOP_10_CMP_URLS_PATH)
        
        analyze_rq1(df, all_urls, top_10_cmp_urls)
        analyze_rq2(df, all_urls)