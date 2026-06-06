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
            selectors worked --> check the error field for selector failures.
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
                not found in DOM, check your detector selectors.
            - "[CMP] - Not showing": presentMatcher matched but
                showingMatcher failed, element exists but is hidden.
            - "Puppeteer Error: <message>": Browser-level failure
                (navigation timeout, page crash).
            - bannerStatus (dict): Independent verification of the cookie banner state,
                evaluated before (baseline) and after (audit) CoM execution.
                Contains two keys: "baseline" and "audit". Each has the following fields:
                - hasTcfApi (bool): Whether the IAB TCF API is present on the page.
                    True for many professional CMPs (OneTrust, Sourcepoint, etc.).
                - tcfVisible (bool|null): True if TCF API reports banner as visible.
                    null if hasTcfApi is false or API timed out.
                - tcfHidden (bool|null): True if TCF API reports banner as hidden.
                    If audit.tcfHidden is true, the banner was successfully closed.
                - scrollLocked (bool): True if the page's scrolling is disabled via CSS 
                    (overflow: hidden), which is an indicator of an active full-screen modal.
                - heuristicBannerFound (bool): True if a fixed/high-z-index element
                    containing consent vocabulary was found in any frame via Midas heuristic.
                - showingMatcherFound (bool|null): True if the specific element defined 
                    in your ruleset's showingMatcher is found and visually visible. 
                    null if no target selector could be parsed from your ruleset or the element is a shadow host.
                    
    Interpreting bannerStatus for self-correction:
    - Best case: audit.tcfHidden=true AND audit.heuristicBannerFound=false 
    AND audit.showingMatcherFound=false --> Banner definitively closed.
    - If baseline.showingMatcherFound=false: Your showingMatcher selector is incorrect! 
    The engine couldn't even find your defined banner before clicking. Fix the detector.
    - If audit.showingMatcherFound=true OR audit.heuristicBannerFound=true: 
    The banner is still visible despite handled=true. Your method selectors (OPEN_OPTIONS, 
    DO_CONSENT, SAVE_CONSENT) likely failed to interact with the correct elements.
    - If baseline.heuristicBannerFound=false: No banner was detected at all before 
    running the engine. Verify the URL or check if the banner requires interaction.
    """
    
    print("testing started!")
    
    script_path = os.path.join(os.path.dirname(__file__), "test_ruleset.js")
    
    print(len(json_string))

    try:
        result = subprocess.run(
            ["node", script_path, url],
            input = json_string,
            capture_output = True,
            text = True,
            timeout = 300,
        )
        
        #Debug logging for process monitoring
        print(f"STDOUT: {result.stdout[:400]}")

        lines = [line for line in result.stdout.strip().splitlines() if line]
        
        #Safeguard against unexpected process terminations or empty outputs
        if not lines:
            return json.dumps({"handled": False, "error": "No output received from the testing environment"})

        output = json.loads(lines[-1])
        return json.dumps(output)

    except subprocess.TimeoutExpired:
        return json.dumps({"handled": False, "error": "Timeout after 300s"})
    except Exception as e:
        return json.dumps({"handled": False, "error": str(e)})