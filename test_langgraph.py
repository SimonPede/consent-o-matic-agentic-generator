from typing import TypedDict
from langgraph.graph import StateGraph, END

# 1. Definieren des States
class State(TypedDict):
    greeting: str
    count: int

# 2. Ein einfacher Knoten (Node)
def node_logic(state: State):
    print("--- Knoten wird ausgeführt ---")
    return {"greeting": "Hallo von LangGraph!", "count": state["count"] + 1}

# 3. Graph aufbauen
workflow = StateGraph(State)
workflow.add_node("agent", node_logic)
workflow.set_entry_point("agent")
workflow.add_edge("agent", END)

# 4. Kompilieren und Ausführen
app = workflow.compile()

print("Starte LangGraph-Testlauf...")
result = app.invoke({"greeting": "", "count": 0})

print(f"Ergebnis: {result['greeting']}")
print(f"Counter: {result['count']}")
print("\n LangGraph-Installation erfolgreich!")