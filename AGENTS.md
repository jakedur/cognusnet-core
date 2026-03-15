# Repository Guidance

## Codex MCP Workflow

When working in this repository with Codex and the local CognusNet MCP server:

- Call `prepare_coding_context` at the start of a coding task and again for follow-up questions that ask why, where, or how something was done.
- Call `record_coding_intent` as soon as the user gives explicit rationale, constraints, or task context that may not survive into the final code.
- Call `record_coding_outcome` after producing code, documentation, or an explanatory answer.
- Do not rely on the generated code alone to preserve rationale. If the reason matters later, write it through `record_coding_intent`.

The intent workflow lives in `cognusnet-core`. The cloud repository consumes this behavior but should not redefine the memory semantics independently.
