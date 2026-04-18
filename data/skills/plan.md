---
name: plan
description: Design an implementation plan before coding
whenToUse: When the user asks to build a feature, fix a non-trivial bug, or refactor — anything beyond a one-line change
allowedTools: [Read, Glob, Grep]
---

# Implementation Planning

Plan before you code. The output is a written plan, not edited files.

1. **Restate the goal** — One sentence describing what success looks like. Confirm with the user if ambiguous.
2. **Map the affected surface** — List every file you'll touch and every public interface you'll change.
3. **Find existing patterns** — Search the codebase for similar features. Reuse existing utilities; don't invent parallel ones.
4. **Identify the minimal change** — What's the smallest set of edits that delivers the goal? Resist scope creep.
5. **Sequence the work** — Order the changes so each step is independently testable. Each step should leave the build green.
6. **Plan verification** — How will you know each step worked? List the commands or manual checks.
7. **Surface risks** — What could go wrong? Migration data loss, breaking changes, perf regression, security holes? Note each with a mitigation.
8. **Write it up** — A short doc with: goal, files touched, sequence, verification, risks. Get user approval before coding.

Rules:
- Don't write code in this phase. Only research and write the plan.
- A plan that lists "all the things" is not a plan. Pick the recommended approach.
- Cite files and functions you'll reuse with `path:line` references.
- If you can't write the plan in one page, the scope is too big — split it.
