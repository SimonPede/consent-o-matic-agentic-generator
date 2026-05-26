import subprocess
import json
import os
from langchain_core.tools import tool

# @tool(args_schema=CoMRuleset)
@tool
def test_ruleset(url: str, json_string: str) -> str:
    """
    Tests the generated Consent-O-Matic ruleset on the live website by
    injecting the CoM engine into a Puppeteer-controlled browser and
    executing the defined consent methods.

    Call this tool when:
    - You have generated a complete ruleset and want to verify it works
    - A previous test failed and you have revised the ruleset based on
        the error feedback
    - You want to verify whether a specific selector exists in the live DOM
        before finalising the ruleset

    Do NOT call this tool if:
    - You have not yet generated a complete ruleset with all required fields
    - The ruleset is clearly incomplete (e.g. missing methods or detectors)
    - You have already successfully passed this test in the current session

    Args:
        url: The URL of the website to test the ruleset on.
        json_string: The complete ruleset as a JSON string, wrapped in the
            CMP name as top-level key:
            {"CMPName": {"detectors": [...], "methods": [...]}}.

    Returns:
        JSON string with the following fields:
        - handled (bool): True if CoM successfully executed all methods
            without a crash. NOTE: handled=true does NOT guarantee all
            selectors worked - check the error field for selector failures.
        - cmpName (str|null): Name of the CMP rule that was triggered.
        - clicks (int): Number of DOM interactions performed. If 0 despite
            handled=true, no selectors matched anything in the DOM.
        - error (str|null): Pipe-separated list of failures encountered.
            Possible entries:
            - "Selector Failed: ACTION_TARGET_NOT_FOUND: <selector>":
                A click/consent target was not found in the DOM. If
                OPEN_OPTIONS failed, downstream DO_CONSENT and SAVE_CONSENT
                selectors will also appear as not found - these are cascade
                failures, not independent bugs. Fix the root cause first
                (the first listed selector failure).
            - "Selector Failed: WAITCSS_TIMEOUT: <selector>":
                A waitcss action timed out waiting for an element.
            - "Invalid CMP <name>": The ruleset has a structural error
                (wrong field names, unsupported action types).
            - "No CMP detected in 5 seconds": presentMatcher selector
                not found in DOM - check your detector selectors.
            - "[CMP] - Not showing": presentMatcher matched but
                showingMatcher failed - element exists but is hidden.
            - "Puppeteer Error: <message>": Browser-level failure
                (navigation timeout, page crash).
    """
    
    print("testing started!")
    
    script_path = os.path.join(os.path.dirname(__file__), "test_ruleset.js")

    try:
        result = subprocess.run(
            ["node", script_path, url, json_string],
            capture_output = True,
            text = True,
            timeout = 300,
        )
        
        # Debug:
        print(f"STDOUT: {result.stdout[:200]}")
        print(f"STDERR: {result.stderr[:200]}")
        print(f"Return code: {result.returncode}")

        #last line of stdout is the result JSON
        lines = [line for line in result.stdout.strip().splitlines() if line]
        output = json.loads(lines[-1])
        return json.dumps(output)

    except subprocess.TimeoutExpired:
        return json.dumps({"handled": False, "error": "Timeout after 300s"})
    except Exception as e:
        return json.dumps({"handled": False, "error": str(e)})
    
    
#for my orientation what I still plan to implement
    # """
    # Tests the generated Consent-O-Matic ruleset on the live website by 
    # injecting the CoM engine and executing the defined methods. Use this 
    # tool to verify whether the ruleset works correctly in practice.
    
    # Call this tool when:
    # - You have generated a complete ruleset and want to verify it works
    # - A previous test failed and you have revised the ruleset based on 
    #     the error feedback
    # - You want to verify whether a specific selector exists in the live DOM
    #     before finalising the ruleset
    
    # Do NOT call this tool if:
    # - You have not yet generated a complete ruleset with all required fields
    # - The ruleset is clearly incomplete (e.g. missing methods or detectors)
    # - You have already successfully passed this test in the current session
    
    # Args:
    #     url: The URL of the website for which the ruleset is being tested.
    #     name: The name of the CMP or ruleset (e.g. "OneTrust", "Cookiebot").
    #     detectors: List of detector objects defining how to identify the banner.
    #     methods: List of method objects defining the consent actions to execute
    #             (HIDE_CMP, OPEN_OPTIONS, DO_CONSENT, SAVE_CONSENT).
    
    # Returns:
    #     Structured JSON string containing: banner_disappeared (bool), 
    #     found_selectors (list), missing_selectors (list), 
    #     error (string or null).
    # """