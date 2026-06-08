import os
import sys
from datetime import datetime

from dotenv import load_dotenv
from langchain_core.messages import HumanMessage
#Utilizing a small db with help of SQLite (), we are not dependend on storage of the thread in RAM (we can get a coffe, before answering the LLM :)):
#for more info: https://reference.langchain.com/python/langgraph.checkpoint.sqlite
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.types import Command

#Import the uncompiled StateGraph blueprint from our agent module
from src.agent.graph import workflow

load_dotenv()

def main() -> None:
    url = sys.argv[1] if (len(sys.argv) > 1) else "https://www.cookiebot.com"
    fresh_session = "--fresh" in sys.argv  #python main.py https://heise.de --fresh

    inputs = {
        "messages": [HumanMessage(content=f"Generate a Consent-O-Matic ruleset for: {url}")],
        "url": url,
        "attempts": 0,
        "human_review_count": 0,
        "last_error": "",
        "structured_dom_info": None,
        "cmp_type": "",
        "screenshot_info": None,
        "current_ruleset_draft": "",
        "final_result": None
    }

    #Thread Checkpointing Strategy: Establishes context persistence
    if fresh_session:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        thread_id = f"{url}_{timestamp}"
    else:
        thread_id = url

    config = {"configurable": {"thread_id": thread_id}}
    
    #Context Manager guarantees seamless SQLite connection handling
    with SqliteSaver.from_conn_string("checkpoints.db") as checkpointer:

        agent = workflow.compile(checkpointer=checkpointer)

        png_data = agent.get_graph(xray=True).draw_mermaid_png()

        try:
            png_data = agent.get_graph(xray=True).draw_mermaid_png()
            with open("graph.png", "wb") as f:
                f.write(png_data)
        except Exception as error:
            print(f"Visualization Note: Skipping graph rendering (graphviz/mermaid missing): {error}")      
            
        print(f"--- Agent starts for: {url} ---")
        current_input = inputs
        
        while True:
            interrupted = False
            
            #NOTE: old version broke on consecutive interrupts (what if the LLM gets stuck multiple times?).
            #this loop handles endless consecutive human reviews safely until the graph finishes.
            for chunk in agent.stream(current_input, config=config):
                for node_name, output in chunk.items():
                    if node_name == "__interrupt__":
                        interrupted = True
                        feedback = input("Your Feedback: ")
                        current_input = Command(resume=feedback)
                    else:
                        print(f"\n[Node: {node_name}]")
            
            if not interrupted:
                print("\n Execution Pipeline Successfully Terminated")
                break
            
if __name__ == "__main__":
    main()