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
    max_tokens=25000,
    streaming=False
    #These flags seem to have no effect with the current backend:
    #thinking=True,
    #reasoning=True
    
    #other params:
    #https://reference.langchain.com/python/langchain-litellm/chat_models/litellm/ChatLiteLLM?_gl=1*hgqbqv*_gcl_aw*R0NMLjE3ODM2OTAwNzEuQ2owS0NRandzTUxTQmhEOUFSSXNBSXBVVERxMjZEYmV0a284RHMxWW9MSDlJTGZLYUZPWDJlWTNfX2ZCMmpFM2oyUUdMMHdKQ0hlUmVXZ2FBcEpyRUFMd193Y0I.*_gcl_au*MTU1MjYyODA4MS4xNzgxMDAxNzcz*_ga*MzAyMjMwMzMzLjE3NzMyMTk1MDM.*_ga_47WX3HKKY2*czE3ODU5MTU3OTUkbzE4JGcwJHQxNzg1OTE1Nzk1JGo2MCRsMCRoMA..
)

#Alternative configuration for models hosted on the SNET server:
# llm = ChatOllama(
#     model=MODEL_NAME,
#     reasoning=True,
#     temperature=1.0,
#     base_url=os.getenv("OLLAMA_BASE_URL"),
#     client_kwargs={"headers": {"Authorization": f"Bearer {os.getenv('OLLAMA_BEARER_TOKEN')}"}},
#     validate_model_on_init=True,
#     num_ctx=262144,
#     num_predict=20000,
#     top_p=0.95,
#     top_k=64
    
#     #why is temperature=1.0 and not 0.0?
#     #--> on https://ollama.com/library/gemma4 the following is advised
#     #Use the following standardized sampling configuration across all use cases:
#     #temperature=1.0
#     #top_p=0.95
#     #top_k=64
    
#     # other params...
#     #https://reference.langchain.com/python/langchain-ollama/chat_models/ChatOllama?_gl=1*vdpck4*_gcl_au*MzczODM4NTUyLjE3NzMyMTk1MDM.*_ga*MzAyMjMwMzMzLjE3NzMyMTk1MDM.*_ga_47WX3HKKY2*czE3NzUzODkyNjYkbzIxJGcxJHQxNzc1MzkzOTM2JGo1NiRsMCRoMA..#member-format-18
# )

#Quick local sanity check:

# response = llm.invoke(
#     "Write a detailed, at least 500-word essay about the history of tea."
# )

# print("Content:", response.content)
# print("\nFull response_metadata:", response.response_metadata)
# print("\nfinish_reason value:", response.response_metadata.get("finish_reason"))