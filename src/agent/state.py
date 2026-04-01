from typing import TypedDict, List, Annotated
from langchain_core.messages import BaseMessage

class AgentState(TypedDict):
    messages: List[BaseMessage]
    url: str
    cmp_type: str
    attempts: int
    #hier kommen alle Variablen der Agent Flow hin