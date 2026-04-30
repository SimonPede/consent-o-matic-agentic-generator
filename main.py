import sys
from src.agent.graph import agent

if __name__ == "__main__":
    url = sys.argv[1] if len(sys.argv) > 1 else "https://www.heise.de"
    
    inputs = {
        "messages": [],
        "url": url,
        "attempts": 0,
        "failed_selectors": [],
        "human_review_count": 0,
        "last_error": "",
        "structured_dom_info": None,
        "cmp_typ": "",
        "screenshot_info": None,
        "final_result": None
    }
    
    print(f"--- Agent starts for: {url} ---")
    for chunk in agent.stream(inputs, config={"configurable": {"thread_id": url}}):
        for node_name, output in chunk.items():
            print(f"\n[Node: {node_name}]")