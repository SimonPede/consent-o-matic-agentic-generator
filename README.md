# Consent-O-Matic Agentic Generator

An LLM-based agentic system designed to autonomously generate JSON rulesets for the [Consent-O-Matic](https://github.com/cavi-au/Consent-O-Matic) browser extension.

> **Status:** This project is under active development as part of a Bachelor's thesis (April–September 2026).

## Overview

This project automates the creation of cookie banner rulesets by combining DOM analysis, multimodal vision, and an iterative self-correction loop. It is developed as part of a Bachelor's thesis in cooperation with the Consent-O-Matic research team at Aarhus University.

## Architecture

The system follows a **ReAct (Reasoning and Acting)** paradigm, orchestrated via **LangGraph**:

- **Perception:** DOM extraction via Puppeteer and visual analysis via multimodal LLMs.
- **Reasoning:** Iterative logic to identify selectors and map consent categories.
- **Action:** Generation of schema-compliant JSON rulesets.
- **Self-Correction:** Automated browser testing to verify ruleset functionality.
- **Human-in-the-Loop:** Console-based feedback mechanism for cases where automated generation fails after 20 tries
   or the LLM decides it needs human support

## Tech Stack

- **Language:** Python 3.11.9 and JS
- **Orchestration:** LangGraph/LangChain
- **Browser Automation:** Node.js & Puppeteer
- **Validation:** Pydantic (Type-safe tool calling)
- **Tracing:** LangSmith

## Project Structure

## Project Structure
```
consent-o-matic-agentic-generator/
├── data/                        # Test URLs and generated results
│   └── results/
├── evaluation/                  # Benchmarking scripts and datasets
│   └── gold_standard/           # Reference rulesets for evaluation
├── src/
│   ├── agent/                   # LangGraph graph, nodes, and state definition
│   ├── prompts/                 # System prompt and few-shot examples (Pseudo-RAG)
│   │   └── examples/            # Rulesets and their corresponding DOM (extracted by my extract tool) used for few-shot examples
│   ├── schemas/                 # Pydantic models for the CoM ruleset schema
│   ├── tools/                   # Custom tools for DOM extraction and testing
│   │   └── consent-engine/      # source code of the CoM-Engine used for the test_ruleset node in Langgraph
│   └── utils/                   # Logging, helper functions and objects/arrays used e.g. regex matching
├── main.py                      # Entry point
├── requirements.txt
└── package.json
```

## Installation & Setup

### Prerequisites

- Python 3.11.9
- Node.js (v18+)
- Ollama/Gemma 4 running on a server from SNET, accessed via bearer-token

1. **Clone the repository:**
   ```bash
   git clone https://github.com/SimonPede/consent-o-matic-agentic-generator.git
   cd consent-o-matic-agentic-generator
   ```
      
2. **Set up Python environment**
   ```bash
    python -m venv .venv
    source .venv/bin/activate  # Windows: .venv\Scripts\activate
    pip install -r requirements.txt
   ```

3. **Install Node.js dependencies**
   ```bash
   npm install
   ```

4. **Configuration**
   Create a `.env` file in the root directory:
   ```bash
    OLLAMA_BASE_URL = http://snet-server:1234
    OLLAMA_BEARER_TOKEN = your-toke-here
   ```

## Usage
   ```bash
   python main.py https://www.example.com --fresh
   ```

## Acknowledgements
This project is developed in cooperation with the Consent-O-Matic team at Aarhus University 
and supervised by Thomas Franklin Cory at the Service-centric Networking (SNET) research 
group, TU Berlin.

## License
This project is licensed under the MIT license, but some utility components in src/utils/ are derived from the Consent Observatory project and are licensed under the Mozilla Public License 2.0.
