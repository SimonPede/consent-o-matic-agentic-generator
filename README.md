# Consent-O-Matic Agentic Generator

An LLM-based agentic system designed to autonomously generate JSON rules for the [Consent-O-Matic](https://github.com/cavi-au/Consent-O-Matic) browser extension.

> **Status:** This project is under active development as part of a Bachelor's thesis (April–September 2026).

## Overview

This project automates the creation of consent interface rules by combining DOM analysis, multimodal vision, and an iterative self-correction loop. It is developed as part of a Bachelor's thesis in cooperation with the Centre for Advanced Visualisation and Interaction (CAVI) at Aarhus University.

## Architecture

The system follows a **ReAct (Reasoning and Acting)** paradigm, orchestrated via **LangGraph**:

- **Perception:** DOM extraction via Puppeteer and visual analysis via multimodal LLMs.
- **Reasoning:** Iterative logic to identify selectors and map consent categories.
- **Action:** Generation of schema-compliant JSON rules.
- **Self-Correction:** Automated browser testing to verify rules functionality.
- **Human-in-the-Loop:** Console-based feedback mechanism for cases where automated generation fails after 20 tries
   or the LLM decides it needs human support.

## Tech Stack

- **Language:** Python 3.11.9 and JavaScript
- **Orchestration:** LangGraph/LangChain
- **Browser Automation:** Node.js & Puppeteer
- **LLM:** Gemma 4 31B via Ollama (SNET server) or Kimi K2.5 via LiteLLM (Aarhus University)
- **Validation:** Pydantic (type-safe tool calling)
- **Tracing & Observability:** LangSmith

## Project Structure

```
consent-o-matic-agentic-generator/
├── data/                        # Test URLs and generated results
│   ├── logs/                    # Logging results
│   ├── results/                 # Verified results
├── evaluation/                  # Evaluation scripts and urls to be evaluated
├── src/
│   ├── agent/                   # LangGraph graph, nodes, and state definition
│   ├── prompts/                 # System prompt and few-shot examples
│   │   └── examples/            # Rules and their corresponding DOM used for few-shot examples
│   ├── schemas/                 # Pydantic model for the CoM rule schema
│   ├── tools/                   # Custom tools (DOM extraction, testing, screenshots)
│   │   └── extract-dom/         # The DOM extraction script providing the LLM with the necessary DOM information
│   │   └── consent-engine/      # Source code of the CoM-Engine used for the test_rule tool
│   ├── utils/                   # Logging, helper functions and objects/arrays used e.g. regex matching
│   │   └── observatory-corpus   # Utility files that are derived from the Consent Observatory project
├── main.py                      # Entry point
├── batch_runner.py              # Used for running the agent over a set of given urls
├── langgraph.json               # LangSmith Studio configuration
├── extract_dom_flow_chart.pdf   # Flow Chart visualizing the logic of my extract-dom script
├── agentic_flow_MVP.pdf         # Visualization of my agentic system and its components
├── requirements.txt             # Pinned direct Python dependencies
├── requirements_dev.txt         # Development-only dependencies (LangSmith Studio)
├── requirements_frozen.txt      # Full dependency snapshot for reproducibility
└── package.json
```

## Installation & Setup

### Prerequisites

- Python 3.11.9
- Node.js (v18+)
- Access to Gemma 4 via Ollama (SNET server, bearer token) or LiteLLM (Aarhus University, API key)
   (other LLMs capable of tool calling & vision as well as reasoning should also provide similar results)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/SimonPede/consent-o-matic-agentic-generator.git
   cd consent-o-matic-agentic-generator
   ```
      
2. **Set up Python environment**
   ```bash
    python -m venv .venv
    source .venv/bin/activate  #Windows: .venv\Scripts\activate
    pip install -r requirements.txt
   ```

3. **Install Node.js dependencies**
   ```bash
   npm install
   ```

### 4. Configuration
 
Create a `.env` file in the root directory:
 
```bash
#Backend switch: choose exactly one
LLM_BACKEND=litellm
#LLM_BACKEND=ollama

#Text-model configuration (examples)
LITELLM_MODEL_NAME=openai/natai/kimi-k2.5
OLLAMA_MODEL_NAME=gemma4:31b

#Vision-model configuration (used by vision tools only)
VISION_MODEL_NAME=natai/kimi-k2.5

#LLM fallback model for extract-dom/settings detection (text-only fallback)
LLM_FALLBACK_NAME=natai/kimi-k2.5

#Provider endpoints/credentials
OLLAMA_BASE_URL=http://snet-server:1234
OLLAMA_BEARER_TOKEN=your-token-here
LITELLM_BASE_URL=http://litellm-server:1234
LITELLM_API_KEY=your-api-key-here
 
#LangSmith Tracing
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=your-langsmith-api-key
LANGSMITH_ENDPOINT=https://api.smith.langchain.com
#Optional:
LANGSMITH_PROJECT="your project"
```

Notes:
- `LLM_BACKEND` controls which provider API is called (`litellm` or `ollama`).
- Text generation in the main agent uses `LITELLM_MODEL_NAME` or `OLLAMA_MODEL_NAME` (depending on backend).
- Vision analysis uses **only** `VISION_MODEL_NAME`.
- `LLM_FALLBACK_NAME` is used by the extract-dom settings fallback (`llm_fallback.js`) and is intentionally separated from the main agent model.
- In this setup, the SDK-based main agent call typically uses `openai/...` model naming, while raw HTTP fallback/vision calls use `natai/...` model group naming.

> All runs are automatically traced to LangSmith when `LANGSMITH_TRACING=true` is set. To disable tracing, set it to `false` — no data will leave your machine.

## Usage
 
```bash
python main.py https://www.example.com
```
 
Add `--fresh` to force a new thread instead of resuming a previous checkpoint:
 
```bash
python main.py https://www.example.com --fresh
```

When wanting to run the agent on multiple websites configure the `urls.txt` (one URL per line) in evaluation/ and use

```bash
python batch_runner.py
```

To persist the full terminal output of a batch run (including node transitions, tool output, and intermediate LLM responses) into a single log file, run:

```bash
python batch_runner.py 2>&1 | tee data/logs/batch_$(date +%Y%m%d_%H%M%S).log
```

## Development: LangSmith Studio (Optional)
 
[LangSmith Studio](https://smith.langchain.com/studio) is a visual interface for interacting with your agent in real-time. It shows each step the agent takes — prompts sent to the model, tool calls and their results, token counts, and latency per node. You can submit inputs directly from the UI, inspect intermediate states, and interact with `human_review` interrupts without using the console.
 
Studio is **not required** for normal usage — `main.py` works independently. Use Studio when you want to visually debug a run or test a specific input interactively.

### Setup
 
Install the development dependencies:
 
```bash
pip install -r requirements_dev.txt
```
 
Start the local agent server (requires WSL users to use `--tunnel`):
 
```bash
langgraph dev
#or for WSL:
langgraph dev --tunnel
```
 
Then open Studio at:
```
https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024
```
 
The agent graph, all state fields, and tool calls are visible and interactive directly in the UI.

## Docker (Alternative)

To ensure absolute reproducibility and avoid dependency conflicts between Python, Node.js, and Puppeteer's Chromium binaries, running the system via Docker is also possible. 

1. Build the image
```bash
docker build -t consent-o-matic-agent .
```

2. Run the agent for a single URL
```bash
#Note: --network host is required to resolve local LLM endpoints (e.g., Ollama)
docker run --rm --network host --env-file .env consent-o-matic-agent https://www.example.com
```

3. Run the batch evaluator:
If you want to evaluate multiple websites listed in evaluation/urls.txt, override the entrypoint:
```bash
docker run --rm --network host --env-file .env --entrypoint python consent-o-matic-agent batch_runner.py
```

Note on Terminal Output: Currently, running the system via Docker may truncate or suppress the intermediate reasoning traces (the "analysis" blocks) in the standard terminal output. If you need to inspect the model's full reasoning process directly in the console, running the system natively is recommended. (Alternatively, use LangSmith Studio to inspect the full trace).


## Acknowledgements

This project is developed in cooperation with the the Centre for Advanced Visualisation and Interaction (CAVI) team at Aarhus University 
and supervised by Thomas Franklin Cory at the Service-centric Networking (SNET) research 
group, TU Berlin.

## License

This project is licensed under the MIT license, but some utility components in src/utils/ are derived from the Consent Observatory project and are licensed under the Mozilla Public License 2.0.
