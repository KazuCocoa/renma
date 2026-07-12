---
name: replace-placeholder
description: Prepare this example's disposable placeholder file, ask once for a constrained replacement, then apply and verify it. Use only for interactive-placeholder; do not use for arbitrary text, other files, or unattended edits.
metadata:
  renma.id: skill.example.replace-placeholder
  renma.owner: maintainers
  renma.allowed-data: '["repo-local-files","disclosed-user-provided-data"]'
  renma.network-allowed: "false"
  renma.external-upload-allowed: "false"
  renma.secrets-allowed: "false"
  renma.requires-human-approval: "false"
  renma.forbidden-inputs: '["secrets","credentials","personal-data"]'
---

# Replace Placeholder

## Routing

Use in `examples/interactive-placeholder`. The agent runs CLI. Renma
validates; it does not execute, ask, store, or resume the workflow.

## Required Inputs

- The example files and write permission for `workspace/output.txt`.
- One user value matching `[A-Za-z0-9_-]{1,32}`, initially missing.

Never guess the replacement value. Do not request or accept secrets, credentials,
or personal data as the value.

## Preflight And Commands

From `examples/interactive-placeholder`, use:

```bash
node tools/placeholder-demo.mjs prepare
node tools/placeholder-demo.mjs inspect
node tools/placeholder-demo.mjs apply EXAMPLE_VALUE
```

The CLI accepts no path and writes only `workspace/output.txt`. Pass the
validated value as one argument, never interpolated shell source.

## Clarify-Before-Act Workflow

1. Run `prepare`, then `inspect`; confirm `<placeholder>` remains.
2. Ask exactly one focused question: "What replacement value should I use?
   Please provide 1-32 letters, numbers, underscores, or hyphens."
3. Stop and wait. Do not run `apply` or modify the file in this turn.
4. Validate against `[A-Za-z0-9_-]{1,32}`. If invalid, explain, ask again, and
   stop without applying.
5. For a valid answer, run `node tools/placeholder-demo.mjs apply VALUE` with
   the answer as its one argument.
6. Run `inspect`; verify the placeholder is absent and the value is present.
7. Report the result. `prepare` resets the output.

## Hard Constraints

- Use only the commands and paths above.
- Do not edit the Skill, README, template, or anything outside the workspace.
- Do not access the network, upload data, read secrets, or write outside this
  example's workspace directory.
- Reject invalid answers without transforming, truncating, or guessing.
- Do not apply when `<placeholder>` is absent.
- A human retains final control over the inspected result.

## Completion Criteria

Complete only after `apply` succeeds and `inspect` returns `State: complete`
with the user value and no `<placeholder>`. Report this evidence.
