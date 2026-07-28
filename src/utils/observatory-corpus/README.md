# Consent Observatory Corpus Data

Source files from the Consent Observatory project (https://github.com/cavi-au/consent-observatory.eu).
Copyright (c) 2023 Rolf Bagge, Janus Kristensen
Copyright (c) 2024, 2025 Janus Kristensen
CAVI, Aarhus University
Mozilla Public License Version 2.0

## Modifications (by Simon Pede)

### 1. NormalizedWordButtonGatherer.js Source
* **Date:** 25.05.2026
* **Changes:** Removed all active gatherer execution logic, isolating only the static `normalizedWords` corpus.
* **Usage:** Serves as the base vocabulary for `settings_buttons_terms.js`. Implemented an automated filter routing mechanism that extracts category 3
    elements and writes them directly into the target configuration module.

### 2. word_box_triggers.js (from WordBoxGatherer.js)
* **Date:** 06.06.2026
* **Changes:** Extracted the multilingual word corpus from the original observatory codebase. Omitted anti-triggers and flattened the nested structure
    down to a clean, highly optimized JavaScript array.
* **Usage:** Leveraged by the `frameHasBanner()` routine within `test_ruleset.js` as an evaluation dictionary to detect layout wrappers containing
    active consent terminology.