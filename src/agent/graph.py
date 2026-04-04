from typing import TypedDict
from langgraph.graph import StateGraph, END

#defining state
class State(TypedDict):
    greeting: str
    count: int

#a simple node
def node_logic(state: State):
    print("--- Node is being processed ---")
    return {"greeting": "Hi from LangGraph!", "count": state["count"] + 1}

workflow = StateGraph(State)
workflow.add_node("agent", node_logic)
workflow.set_entry_point("agent")
workflow.add_edge("agent", END)

app = workflow.compile()

print("Starting LangGraph testing...")
result = app.invoke({"greeting": "", "count": 0})

print(f"result: {result['greeting']}")
print(f"counter: {result['count']}")
print("\n LangGraph installation succesfull!")