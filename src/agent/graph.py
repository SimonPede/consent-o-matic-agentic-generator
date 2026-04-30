from dotenv import load_dotenv
import subprocess
import json

from typing import Literal
from langchain_ollama import ChatOllama
from langchain_core.messages import AnyMessage, SystemMessage, HumanMessage, ToolMessage
from langchain_core.tools import tool
from langgraph.graph import StateGraph, START, END
from langgraph.prebuilt import ToolNode
from langgraph.checkpoint.memory import MemorySaver
from langgraph.types import interrupt

from state import AgentState
# from nodes import Nodes

load_dotenv() #in .env my API key is stored

llm = ChatOllama(
    model = "gemma4:31b",
    reasoning = True,
    temperature = 0,
    # other params...
    #https://reference.langchain.com/python/langchain-ollama/chat_models/ChatOllama?_gl=1*vdpck4*_gcl_au*MzczODM4NTUyLjE3NzMyMTk1MDM.*_ga*MzAyMjMwMzMzLjE3NzMyMTk1MDM.*_ga_47WX3HKKY2*czE3NzUzODkyNjYkbzIxJGcxJHQxNzc1MzkzOTM2JGo1NiRsMCRoMA..#member-format-18
)

#for implementing: o	bei frameScore bewertung: es so bauen, dass wenn der falsche Frame gefunden wird,
#es ja aber durch guten Score trotzdem dem LLM gegeben wird und das LLM sagt „the fuck. Ich kann hier nichts für die Regeln finden“,
# dann das System so bauen, dass es zurück in geht und dem LLM das DOM für den zweitbesten Frame extrahiert und so weiter. Wie?!
#i have to implemented extratc as a tool and a node, right?
# @tool
# def extract_dom_tool(url: str, state: AgentState) -> dict: #doesnt need the State, right?
#     """extract the DOM... detailed desicription with params etc for LLM"""

#     return {}
    
@tool
def analyse_screenshot(url: str) -> str:
    """
    Input: URL (String)
    Output: Structured JSON string with: banner visible (yes/no), banner position, found
        buttons with text and colour
    Purpose:
        Supplements DOM analysis with visual information. Particularly useful
        when the DOM is obfuscated or button texts are not present in the HTML.
        Answers: Is a banner visible? Which buttons are shown? Where are they
        positioned?
    """
    return ""

# @tool
# def request_human_review(state: AgentState) -> str:
#     return ""

@tool
def test_ruleset(url: str, json_string: str) -> str:
    """
    Input: URL (String)
    Output: Structured JSON string with: banner visible (yes/no), banner position, found
        buttons with text and colour
    Purpose:
        Supplements DOM analysis with visual information. Particularly useful
        when the DOM is obfuscated or button texts are not present in the HTML.
        Answers: Is a banner visible? Which buttons are shown? Where are they
        positioned?
    """
    return ""

@tool
def validate_json(json_string: str) -> str:
    """
    Input: JSON string (generated ruleset)
    Output: "valid" or "invalid (with error description)"
    Purpose:    
        Syntactic correctness and schema conformity are enforced by the
        Pydantic model (CoMRuleset) at the point of the test_ruleset tool call.
        validate_json serves as a lightweight pre-check, verifying semantic
        plausibility: do the generated selectors exist in the previously extracted
        DOM? Are there contradictions between the defined methods and the
        available DOM elements?
    """
    return ""
    

tools = [analyse_screenshot, test_ruleset, validate_json]
tools_by_name = {tool.name: tool for tool in tools}
model_with_tools = llm.bind_tools(tools)

def extraction_node(state: AgentState) -> dict: #doesnt need the State, right?
    """
    Input: URL (String)
    Output:
        Structured JSON object with: found buttons/sliders/toggles (text, selector,
        probable action, category), filtered HTML snippet as fallback (without
        style, scripts, img etc.), metadata (URL, detected CMP)
    Purpose:
        Extracts the relevant DOM section of the cookie banner using frame
        traversal and shadow DOM traversal via parent-target selection according
        to the CoM engine specification. First attempts to find known CMPs
        (OneTrust, Cookiebot, etc.) via specific selectors, falls back to generic
        heuristics (z-index, cookie keywords in classes/IDs), and uses the entire
        body as a last resort fallback.
    """

    url = state.get("url", "")
    
    result = subprocess.run(
        ["node", "../tools/extract_dom.js", url],
        capture_output = True,
        text = True
    )

    if result.returncode != 0:
        print("extraction_node, extract_tool returned 1:", result.stderr)
        return {
            "last_error": result.stderr
        }
    
    print("=== STDOUT ===")
    print(repr(result.stdout[:500]))  # erste 500 Zeichen
    print("=== STDERR ===")  
    print(result.stderr[:200])
    output = json.loads(result.stdout)
    
    return {
        #why am i not using ToolMessage? because ToolMessage needs a tool_call_id! 
        #HumanMessage can be used to inject context
        "messages": [HumanMessage(content = f"Here is the DOM info, extracted by the extract tool: {output}")],
        "structured_dom_info": output
    }


def llm_node(state: AgentState):
    """"""
    # system_prompt = SystemMessage(content = "System prompt hier importieren! Der steht in system_prompt.py mit few-shot beispielen. Sind diese automatisch eingefügt?")
    # return {
    #     "messages": [
    #         model_with_tools.invoke(
    #             [system_prompt] + state["messages"] #kombiniert die festen Verhaltensregeln (SystemMessage) mit dem aktuellen Gedächtnis des Agenten
    #         )
    #     ],
    #     #or rather more like that?
    #     #"messages": [
    #     #     model_with_tools.invoke(
    #     #         [
    #     #             SystemMessage(
    #     #                 content="You are a helpful assistant tasked with performing arithmetic on a set of inputs."
    #     #             )
    #     #         ]
    #     #         + state["messages"]
    #     #     )
    #     # ],
    #     "attempts": state.get("attempts", 0) + 1
    # }
    from langchain_core.messages import AIMessage
    return {
        "messages": [AIMessage(content="TEMP: LLM not callable")],
        "attempts": state.get("attempts", 0) + 1
    }

def route_after_llm(state: AgentState) -> Literal["tool_node", "human_review_node", "ruleset_output_node"]:
    
    if state.get("attempts", 0) >= 20:
        return "human_review_node"
    
    last_message = state["messages"][-1]
    
    if not last_message.tool_calls:
        return "ruleset_output_node"
    
    return "tool_node"

tool_node = ToolNode(tools)

def human_review_node(state: AgentState) -> object:
    
    last_message = state["messages"][-1]
    
    attempts = state.get("attempts", 0)
    llm_choice = True
    
    if attempts >= 20:
        llm_choice = False
        
    question = ""
    if llm_choice:
        question = "The Agent seems to be stuck, this call was not choicen by the LLM. It already needed 20 attempts and needs help. Please give Feedback:"
    else: question = "The Agent seems to be stuck and needs help. Please give Feedback:"
        
    context = {
        "question": question,
        "url": state.get("url"),
        "attempts": attempts,
        "last_message": str(last_message.content),
        "failed_selectors": state.get("failed_selectors", []),
        "last_error": state.get("last_error", "No error stored!"),
        "current_ruleset": state.get("final_result", "No ruleset generated yet.")
    }
    
    print("\n" + "=" * 40)
    print("HUMAN REVIEW REQUIRED")
    print("="*20)
    print(f"URL:              {context['url']}")
    print(f"Tries:         {context['attempts']}")
    print(f"Last error:   {context['last_error']}")
    print(f"Failed Selectors: {context['failed_selectors']}")
    print(f"\nRuleset draft:")
    print(json.dumps(context['current_ruleset'], indent = 2))
    print("=" * 40)
    
    human_input = interrupt({context})
    
    return {
        "messages": [HumanMessage(content = f"Human feedback: {human_input}")],
        "human_review_count": state.get("human_review_count", 0) + 1
    }

def ruleset_output_node(state: AgentState) -> dict:
    #later: extract final JSON from messages
    print("\n----------FINAL RESULT--------------")
    print(f"Attempts: {state.get('attempts', 0)}")
    print(f"Final Result: {state.get('final_result', 'Nothing generated!')}")
    return {}

#Code aus den docs:
# from langchain.messages import ToolMessage
# def tool_node(state: dict):
#     """Performs the tool call"""

#     result = []
#     for tool_call in state["messages"][-1].tool_calls:
#         tool = tools_by_name[tool_call["name"]]
#         observation = tool.invoke(tool_call["args"])
#         result.append(ToolMessage(content=observation, tool_call_id=tool_call["id"]))
#     return {"messages": result}

workflow = StateGraph(AgentState)

workflow.add_node("extraction_node", extraction_node)
workflow.add_node("llm_node", llm_node)
workflow.add_node("tool_node", tool_node)
workflow.add_node("human_review_node", human_review_node)
workflow.add_node("ruleset_output_node", ruleset_output_node)

# Add edges to connect nodes
workflow.add_edge(START, "extraction_node")
workflow.add_edge("extraction_node", "llm_node")

workflow.add_conditional_edges(
    "llm_node",
    route_after_llm,
    ["tool_node", "human_review_node", "ruleset_output_node"]
)
workflow.add_edge("tool_node", "llm_node")
workflow.add_edge("human_review_node", "llm_node")

workflow.add_edge("ruleset_output_node", END)

memory = MemorySaver()

agent = workflow.compile(checkpointer = memory)

#Show the agent
png_data = agent.get_graph(xray=True).draw_mermaid_png()

with open("graph.png", "wb") as f:
    f.write(png_data)


#Invoke
inputs = {
    "messages": [HumanMessage(content = "Generiere ein Ruleset für diese Website.")],
    "attempts": 0,
    "url": "https://www.heise.de"
}

print("--- Agent starts hussling... ---")
for chunk in agent.stream(inputs, config = {"configurable": {"thread_id": "1"}}):
    for node_name, output in chunk.items():
        print(f"\n[Node: {node_name}]")