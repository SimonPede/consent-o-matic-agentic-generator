import os
from dotenv import load_dotenv

from langchain_ollama import ChatOllama
from langchain_litellm import ChatLiteLLM

load_dotenv()

LLM_BACKEND = os.getenv("LLM_BACKEND", "litellm").strip().lower()
LITELLM_MODEL_NAME = os.getenv("LITELLM_MODEL_NAME") or os.getenv("LLM_MODEL_NAME")
OLLAMA_MODEL_NAME = os.getenv("OLLAMA_MODEL_NAME") or os.getenv("LLM_MODEL_NAME")
MODEL_NAME = OLLAMA_MODEL_NAME if LLM_BACKEND == "ollama" else LITELLM_MODEL_NAME

if LLM_BACKEND == "ollama":
    llm = ChatOllama(
        model=OLLAMA_MODEL_NAME,
        base_url=os.getenv("OLLAMA_BASE_URL"),
        client_kwargs={"headers": {"Authorization": f"Bearer {os.getenv('OLLAMA_BEARER_TOKEN', '')}"}},
        reasoning=True,
        temperature=1.0,
        validate_model_on_init=True,
        num_ctx=262144,
        num_predict=20000,
        top_p=0.95,
        top_k=64
        
        #why is temperature=1.0 and not 0.0?
        #--> on https://ollama.com/library/gemma4 the following is advised
        #Use the following standardized sampling configuration across all use cases:
        #temperature=1.0
        #top_p=0.95
        #top_k=64
    )
    
else:
    llm = ChatLiteLLM(
        model=LITELLM_MODEL_NAME,
        api_base=os.getenv("LITELLM_BASE_URL"),
        api_key=os.getenv("LITELLM_API_KEY"),
        temperature=0,
        max_tokens=25000,
        streaming=False
    )
