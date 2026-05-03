import os
from dotenv import load_dotenv

from langchain_ollama import ChatOllama

load_dotenv()

llm = ChatOllama(
    model = "gemma4:31b",
    reasoning = True,
    temperature = 0,
    base_url = os.getenv("OLLAMA_BASE_URL"),
    client_kwargs = {"headers": {"Authorization": f"Bearer {os.getenv('OLLAMA_API_KEY')}"}},
    # validate_model_on_init = True,
    # other params...
    #https://reference.langchain.com/python/langchain-ollama/chat_models/ChatOllama?_gl=1*vdpck4*_gcl_au*MzczODM4NTUyLjE3NzMyMTk1MDM.*_ga*MzAyMjMwMzMzLjE3NzMyMTk1MDM.*_ga_47WX3HKKY2*czE3NzUzODkyNjYkbzIxJGcxJHQxNzc1MzkzOTM2JGo1NiRsMCRoMA..#member-format-18
)