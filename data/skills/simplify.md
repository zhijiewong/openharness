---
name: simplify
description: Refactor code to be simpler and more maintainable without changing behavior
whenToUse: When code is hard to read, has duplicated logic, over-abstracts, or accumulated dead branches
allowedTools: [Read, Edit, Bash, Glob, Grep]
---

# Simplify Code

Simpler code is easier to read, change, and debug. Behavior must not change.

1. **Read the code in scope** — Understand what it does end-to-end before touching anything.
2. **List the smells** — Duplication, dead branches, premature abstraction, deeply nested conditionals, vague names, comments that explain WHAT instead of WHY.
3. **Confirm tests cover the behavior** — If there are no tests, write characterization tests first. Refactoring without tests is gambling.
4. **Make one change at a time** — Inline a wrapper, extract a function, rename a variable, delete dead code. Run tests after each.
5. **Prefer deletion over addition** — If you can remove code without breaking tests, that's almost always the right move.
6. **Stop when it's good enough** — Don't refactor for its own sake. Stop when further changes wouldn't meaningfully improve readability.

Rules:
- Never change behavior. If you discover a bug, file it separately — don't fix it during a refactor.
- Three similar lines is better than a premature abstraction. Wait until the third or fourth occurrence before extracting.
- Delete comments that explain what well-named code already says.
- If the change touches more than one file or one concern, split it into separate refactors.
- Don't introduce new dependencies, frameworks, or patterns.
