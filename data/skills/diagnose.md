---
name: diagnose
description: Diagnose why an agent run failed, regressed, or produced unexpected output — using structured evidence instead of intuition
whenToUse: When an agent run produced wrong output, crashed mid-execution, or regressed from a previous successful run
allowedTools: [Read, Bash, Grep, Glob]
---

# Diagnose Agent Run

Apply this when something an agent did went wrong — not for ordinary code bugs (use `debug` for those).

1. **Define the failure precisely** — What was the expected output? What was the actual output? One sentence each.
2. **Locate the artifacts** — Find the run's logs, transcripts, tool-call traces, and any files it produced. Common locations: `.oh/logs/`, `.oh/tasks.json`, `.oh/sessions/`, stderr capture.
3. **Reconstruct the timeline** — Walk through tool calls in order. Where did the trajectory diverge from what should have happened?
4. **Isolate the inflection point** — Find the single tool call, prompt step, or input that turned a working run into a broken one.
5. **Form a hypothesis** — Was it bad input, model regression, missing context, tool timeout, permission denial, or stale memory? Be specific.
6. **Verify with a minimal repro** — Re-run only the inflection step in isolation. Confirm the same wrong behavior reproduces.
7. **Report** — Write up: failure mode, inflection point (file:line or message index), root cause, suggested fix.

Rules:
- Don't guess from the symptom. Read the actual logs.
- Distinguish "the model made a bad decision" from "the harness broke" — they need different fixes.
- If the run is non-deterministic, repro at least 3 times before claiming a hypothesis.
- Never edit code as part of diagnosis. The output is a report, not a fix.
