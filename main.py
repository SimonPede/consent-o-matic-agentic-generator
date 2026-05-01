import sys
from datetime import datetime

# from langgraph.checkpoint.memory import MemorySaver
#now i want to utilize a small db with help of SQLite () so i am not dependend on storage of the thread in RAM (i can get a coffe, before answering the LLM :)):
#https://reference.langchain.com/python/langgraph.checkpoint.sqlite
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.types import Command
from src.agent.graph import workflow
from langchain_core.messages import HumanMessage


url = sys.argv[1] if (len(sys.argv) > 1) else "https://www.heise.de"
fresh = "--fresh" in sys.argv  #python main.py https://heise.de --fresh

inputs = {
    "messages": [HumanMessage(content = f"Generate a Consent-O-Matic ruleset for: {url}")],
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

#Threads enable the checkpointing of multiple different runs, making them essential for multi-tenant chat applications
#and other scenarios where maintaining separate states is necessary.
#A thread is a unique ID assigned to a series of checkpoints saved by a checkpointer. When using a checkpointer,
#you must specify a thread_id and optionally checkpoint_id when running the graph.
#thread_id is simply the ID of a thread. This is always required.
#checkpoint_id can optionally be passed. This identifier refers to a specific checkpoint within a thread. This can be used to kick off a run of a graph from some point halfway through a thread.
#You must pass these when invoking the graph as part of the configurable part of the config, e.g.

# {"configurable": {"thread_id": "1"}}  # valid config
# {"configurable": {"thread_id": "1", "checkpoint_id": "0c62ca34-ac19-445d-bbb0-5b4984975b2a"}}  # also valid config

if fresh:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    thread_id = f"{url}_{timestamp}"
else:
    thread_id = url

config = {"configurable": {"thread_id": thread_id}}

with SqliteSaver.from_conn_string("checkpoints.db") as checkpointer:

    agent = workflow.compile(checkpointer = checkpointer)

    png_data = agent.get_graph(xray = True).draw_mermaid_png()

    with open("graph.png", "wb") as f:
        f.write(png_data)
        
    print(f"--- Agent starts for: {url} ---")
    #my first version:
    # for chunk in agent.stream(inputs, config = config):
    #     for node_name, output in chunk.items():
    #         if node_name == "__interrupt__":

    #             print("\n" + "-"*30)
    #             feedback = input("Your Feedback: ")

    #             for chunk in agent.stream(Command(resume = feedback), config = config):
    #                 for node_name, output in chunk.items():
    #                     print(f"\n[Node: {node_name}]")
    #         else:
    #             print(f"\n[Node: {node_name}]")
    
    #my second version should correct a flaw, i think would create problems
    #what happens when a sceond interrupt is called?
    current_input = inputs
    
    while True:
        interrupted = False
        
        for chunk in agent.stream(current_input, config = config):
            for node_name, output in chunk.items():
                if node_name == "__interrupt__":
                    interrupted = True
                    feedback = input("Your Feedback: ")
                    current_input = Command(resume = feedback)
                else:
                    print(f"\n[Node: {node_name}]")
        
        if not interrupted:
            break