import os
from dotenv import load_dotenv

from langchain_ollama import ChatOllama
from langchain_litellm import ChatLiteLLM

load_dotenv()

#LiteLLM models:
MODEL_NAME="openai/natai/kimi-k2.5"
#MODEL_NAME="openai/cavi/medium"
#MODEL_NAME="openai/cavi/small"
#MODEL_NAME="openai/natai/gpt-oss"

#Ollama models:
#MODEL_NAME="gemma4:31b"
# MODEL_NAME="qwen3.6:latest"
# MODEL_NAME="qwen3:32b"

llm = ChatLiteLLM(
    model=MODEL_NAME,
    api_base=os.getenv("LITELLM_BASE_URL"),
    api_key=os.getenv("LITELLM_API_KEY"),
    temperature=0,
    max_tokens=6000,
    stream=False
    #These flags seem to have no effect with the current backend:
    #thinking=True,
    # reasoning=True
)

#Alternative configuration for models hosted on the SNET server:
# llm = ChatOllama(
#     model=MODEL_NAME,
#     reasoning=True,
#     temperature=1.0,
#     base_url=os.getenv("OLLAMA_BASE_URL"),
#     client_kwargs={"headers": {"Authorization": f"Bearer {os.getenv('OLLAMA_BEARER_TOKEN')}"}},
#     validate_model_on_init=True,
#     num_ctx=32768,
#     num_predict=4096,
#     top_p=0.95,
#     top_k=64
#     # other params...
#     #https://reference.langchain.com/python/langchain-ollama/chat_models/ChatOllama?_gl=1*vdpck4*_gcl_au*MzczODM4NTUyLjE3NzMyMTk1MDM.*_ga*MzAyMjMwMzMzLjE3NzMyMTk1MDM.*_ga_47WX3HKKY2*czE3NzUzODkyNjYkbzIxJGcxJHQxNzc1MzkzOTM2JGo1NiRsMCRoMA..#member-format-18
# )

#Quick local sanity check:
# response = llm.invoke("Say hello in one sentence.")
# print(response.content)