# Consent-O-Matic Agentic Generator

An LLM-based agentic system designed to autonomously generate JSON rulesets for the [Consent-O-Matic](https://github.com/cavi-au/Consent-O-Matic) browser extension.

> **Status:** This project is under active development as part of a Bachelor's thesis (April–September 2025).

## Overview
This project automates the creation of cookie banner rulesets by combining DOM analysis, multimodal vision, and an iterative self-correction loop. It is developed as part of a Bachelor's thesis in cooperation with researchers from Aarhus University.

## Architecture
The system follows a **ReAct (Reasoning and Acting)** paradigm, orchestrated via **LangGraph**:
- **Perception:** DOM extraction via Puppeteer and visual analysis via Multimodal LLMs.
- **Reasoning:** Iterative logic to identify selectors and map consent categories.
- **Action:** Generation of schema-compliant JSON rulesets.
- **Self-Correction:** Automated browser testing to verify ruleset functionality.

## Tech Stack
- **Language:** Python 3.11.9
- **Orchestration:** LangGraph/LangChain
- **Browser Automation:** Node.js & Puppeteer
- **Validation:** Pydantic (Type-safe tool calling)
- **Tracing:** LangSmith

## Project Structure
- `data/`: Test URLs and generated results
- `evaluation/`: Scripts and datasets for benchmarking.
- `evaluation/gold_standard/`: Reference rulesets for benchmarking
- `src/agent/`: LangGraph orchestration and logic.
- `src/prompts/`: System prompt and few-shot examples
- `src/schemas/`: Pydantic models for the CoM rulesets
- `src/tools/`: Custom tools for DOM extraction and testing.
- `src/utils/`: General helper functions, such as custom logging, file I/O operations, and string processing for DOM cleaning.

## Installation & Setup

### Prerequisites
- Python 3.11.9
- Node.js (v18+)
- OpenAI API Key (will switch to an Open-Source-Model in the near future)

1. **Clone the repository:**
   ```bash
   git clone https://github.com/SimonPede/consent-o-matic-agentic-generator.git
   cd consent-o-matic-agentic-generator
   
2. **Set up Python environment**
   ```bash
    python -m venv .venv
    source .venv/bin/activate  # Windows: .venv\Scripts\activate
    pip install -r requirements.txt

3. **Install Node.js dependencies**
   ```bash
   npm install

4. **Configuration**
   Create a .env file in the root directory and add your OpenAI API Key:
   ```bash
    OPENAI_API_KEY=your_key_here

## Usage
python main.py --url https://www.example.com

## Acknowledgements
This project is developed in cooperation with the Consent-O-Matic team at Aarhus University 
and supervised by Thomas Franklin Cory at the Service-centric Networking (SNET) research 
group, TU Berlin.
