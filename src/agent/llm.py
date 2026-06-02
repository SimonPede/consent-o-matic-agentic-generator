import os
from dotenv import load_dotenv

from langchain_ollama import ChatOllama
from langchain_litellm import ChatLiteLLM

load_dotenv()

llm = ChatLiteLLM(
    #model="openai/natai/kimi-k2.5",
    # model="openai/natai/minimax-m2.5",
    model = "openai/cavi/medium",
    api_base = os.getenv("LITELLM_BASE_URL"),
    api_key = os.getenv("LITELLM_API_KEY"),
    temperature = 0,
    max_tokens = 5000,
    #seems to have no effect:
    # thinking=True,
    # reasoning = True
)

#for quick testing:
# response = llm.invoke("Say hello in one sentence.")
# print(response.content)

#for accessing models on the SNET Server
# llm = ChatOllama(
#     model = "gemma4:latest",
#     # model = "qwen3:32b",
#     reasoning = True,
#     temperature = 0,
#     base_url = os.getenv("OLLAMA_BASE_URL"),
#     client_kwargs = {"headers": {"Authorization": f"Bearer {os.getenv('OLLAMA_BEARER_TOKEN')}"}},
#     validate_model_on_init = True,
#     # num_ctx = 128000,
#     # num_predict = 45000
#     # other params...
#     #https://reference.langchain.com/python/langchain-ollama/chat_models/ChatOllama?_gl=1*vdpck4*_gcl_au*MzczODM4NTUyLjE3NzMyMTk1MDM.*_ga*MzAyMjMwMzMzLjE3NzMyMTk1MDM.*_ga_47WX3HKKY2*czE3NzUzODkyNjYkbzIxJGcxJHQxNzc1MzkzOTM2JGo1NiRsMCRoMA..#member-format-18
# )