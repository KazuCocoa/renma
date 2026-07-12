---
name: replace-placeholder
description: Prepare this example's disposable placeholder file, ask for a constrained replacement, then apply and verify it. Use only for interactive-placeholder; do not use for arbitrary text, other files, or unattended edits.
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

Use only in `examples/interactive-placeholder`. The consuming agent follows the
[local tool guide](../../tools/README.md). Renma validates the repository; the
agent owns the interaction and tool use.

## Required Inputs And Preflight

- The example files and write permission for `workspace/output.txt`.
- One user value matching `[A-Za-z0-9_-]{1,32}`, initially missing.

## Clarify-Before-Act Workflow

1. Follow the guide's `prepare` and `inspect` operations.
2. If inspection shows a missing replacement, ask one focused question for an
   accepted value, then stop and wait.
3. Validate the response without changing it.
4. For a valid response, follow the guide's `apply` and `inspect` operations.
5. Verify the placeholder is absent and the value is present, then report the
   inspected result for human review.

## Hard Constraints

- Use only the fixed guide and its anchored paths.
- If the value is missing, ask one focused question and stop.
- If the value is invalid, explain the accepted format, ask again, and stop.
- Never guess, transform, or truncate the value; ask again instead.
- Do not request or accept secrets, credentials, or personal data; ask for a non-sensitive value instead.
- Do not apply when `<placeholder>` is absent; stop and report the inspected state.
- Do not edit the Skill, READMEs, or immutable template; leave them unchanged.
- Do not access the network, upload data, or write outside the example workspace; stop and report the blocked operation.
- A human retains final control over the inspected result.

## Completion Criteria

Complete only after the documented `apply` succeeds and `inspect` returns
`State: complete` with the user value and no `<placeholder>`. Report this
evidence.
