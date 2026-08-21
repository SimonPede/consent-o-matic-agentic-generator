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
        temperature=1.0,
        top_p = 1.0,
        max_tokens=25000,
        streaming=False
    )

def _print_response_shape(label: str, response) -> None:
    print(f"\n=== {label} ===")
    print(f"response class: {type(response).__name__}")
    print(f"content class: {type(response.content).__name__}")

    if isinstance(response.content, list):
        print(f"content blocks: {len(response.content)}")
        for index, block in enumerate(response.content, start=1):
            if isinstance(block, dict):
                block_type = block.get("type", "unknown")
                keys = list(block.keys())
                preview = (block.get("text") or block.get("thinking") or "")
                preview = str(preview).replace("\n", " ")[:140]
                print(f"  [{index}] type={block_type} keys={keys} preview={preview!r}")
            else:
                preview = str(block).replace("\n", " ")[:140]
                print(f"  [{index}] non-dict block preview={preview!r}")
    else:
        preview = str(response.content).replace("\n", " ")[:240]
        print(f"content preview: {preview!r}")

    try:
        print("metadata keys:", list((response.response_metadata or {}).keys()))
    except Exception:
        print("metadata keys: <unavailable>")


def debug_backend_output_shapes() -> None:
    """Small local helper to inspect where thinking/text blocks appear per backend."""
    prompt = (
        "Think step-by-step, then answer in one short sentence about why cookies are used."
    )

    lite_model = os.getenv("LITELLM_MODEL_NAME") or os.getenv("LLM_MODEL_NAME")
    lite_base = os.getenv("LITELLM_BASE_URL")
    lite_key = os.getenv("LITELLM_API_KEY")

    if lite_model and lite_base and lite_key:
        try:
            lite_client = ChatLiteLLM(
                model=lite_model,
                api_base=lite_base,
                api_key=lite_key,
                temperature=0,
                max_tokens=1024,
                streaming=False,
            )
            lite_response = lite_client.invoke(prompt)
            _print_response_shape(f"LiteLLM ({lite_model})", lite_response)
        except Exception as error:
            print(f"\n=== LiteLLM ({lite_model}) failed ===\n{error}")
    else:
        print("\n=== LiteLLM debug skipped ===\nMissing LITELLM_MODEL_NAME/BASE_URL/API_KEY")

    ollama_model = os.getenv("OLLAMA_MODEL_NAME") or os.getenv("LLM_MODEL_NAME")
    ollama_base = os.getenv("OLLAMA_BASE_URL")
    ollama_token = os.getenv("OLLAMA_BEARER_TOKEN", "")

    if ollama_model and ollama_base:
        try:
            ollama_client = ChatOllama(
                model=ollama_model,
                base_url=ollama_base,
                client_kwargs={"headers": {"Authorization": f"Bearer {ollama_token}"}},
                temperature=0,
            )
            ollama_response = ollama_client.invoke(prompt)
            _print_response_shape(f"Ollama ({ollama_model})", ollama_response)
        except Exception as error:
            print(f"\n=== Ollama ({ollama_model}) failed ===\n{error}")
    else:
        print("\n=== Ollama debug skipped ===\nMissing OLLAMA_MODEL_NAME/BASE_URL")


if __name__ == "__main__":
    if os.getenv("DEBUG_BACKEND_OUTPUT_SHAPES", "0") == "1":
        debug_backend_output_shapes()