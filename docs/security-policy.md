# Renma Security Policy Guide

Use this guide when writing security-sensitive skills or context assets. It is a practical policy-authoring companion to the [User Manual](user-manual.md). For full finding definitions, see the [Diagnostics Reference](diagnostics.md).

Renma security diagnostics are deterministic repository checks for agent-facing operational instructions. They do not execute commands, call an LLM, enforce runtime behavior, inject context, or turn Renma into a broad supply-chain scanner.

## Security Policy Quickstart

Add small security policy metadata to agent-facing skills or context assets when they include network, upload, secret-handling, command execution, or other sensitive operational instructions.

### Asset-local security policy

Use asset-local policy when one asset has stricter or unique requirements, the body contains sensitive instructions, or local denials should be explicit and reviewable:

```yaml
---
id: skill.diagnostics.local-triage
owner: qa-platform
status: stable
allowed_data:
  - public
  - sanitized diagnostics
network_allowed: true
external_upload_allowed: false
secrets_allowed: false
requires_human_approval: true
forbidden_inputs:
  - secrets
  - credentials
  - tokens
---
```

Asset-local explicit denials remain stricter than inherited profile or repository allowances. For example, `external_upload_allowed: false` on an asset still blocks upload instructions even if a selected profile or repository config allows uploads elsewhere.

### Reusable security profiles

Use `security_profile` when many assets share the same policy, a team wants a reusable security contract, or policy should be centrally updated in `renma.config.json`.

Configure profiles under `security.profiles`:

```json
{
  "security": {
    "profiles": {
      "disclosed-local-diagnostics": {
        "allowedData": ["public", "sanitized diagnostics"],
        "networkAllowed": true,
        "externalUploadAllowed": false,
        "secretsAllowed": false,
        "humanApprovalRequired": true,
        "forbiddenInputs": ["secrets", "credentials", "tokens"],
        "approvedDomains": ["github.com"],
        "approvedUploadDomains": []
      }
    }
  }
}
```

Then select the profile from an asset:

```yaml
---
security_profile: disclosed-local-diagnostics
---
```

### Repository-level security config

Use repo-level `security.approvedDomains`, `security.approvedUploadDomains`, or `security.disallowedCommands` when the policy applies across the repository and common destinations or disallowed commands should be shared.

```json
{
  "security": {
    "approvedDomains": ["github.com"],
    "approvedUploadDomains": [],
    "disallowedCommands": ["gh gist create"],
    "profiles": {}
  }
}
```

### Choosing where to put policy

Prefer the narrowest policy location that matches the decision:

- Use asset-local fields for one-off restrictions, explicit denials, or sensitive instructions that need nearby review.
- Use `security_profile` for reusable team contracts shared by several assets.
- Use repository-level security config for common approved network destinations, upload destinations, or disallowed commands that apply broadly.

If settings disagree, keep the stricter effective policy. Do not relax asset-local denials through a profile or repository allowance.

### Human approval semantics

`requires_human_approval: true` requires explicit nearby approval wording for sensitive actions. Dry-run, backup, rollback, or restore guidance is useful, but it does not replace explicit approval when approval is required.

Keep approval wording close to the action it guards, especially for uploads, external sharing, privileged commands, destructive commands, or secret-handling workflows.

### Network approval vs upload approval

`approvedDomains` does not imply upload approval. Network access and upload permission are separate decisions.

Use `approved_network_destinations`, profile `approvedDomains`, or repository `security.approvedDomains` for general network destinations. Use `approved_upload_destinations`, profile `approvedUploadDomains`, or repository `security.approvedUploadDomains` for upload destinations.

### Forbidden inputs

Use `forbidden_inputs` to name data classes an asset must not request, copy, upload, summarize, or include in prompts. Common examples are `secrets`, `credentials`, `tokens`, `private keys`, `.env files`, customer data, and production logs.

Safe negative wording is useful:

```markdown
Never copy private keys, tokens, credentials, or `.env` files into prompts, logs, uploads, or diagnostics.
```

### Defensive guidance and false positives

Renma security diagnostics are conservative heuristics for discovered agent-facing assets. Defensive wording can avoid false positives when it is specific and close to the risky instruction.

Unsafe upload:

```markdown
Upload the full repository to S3.
```

Safer:

```markdown
Do not upload repository files externally. If sharing diagnostics is required, provide only redacted snippets after explicit human approval.
```

Unsafe secret handling:

```markdown
Copy ~/.ssh/id_ed25519 into the prompt.
```

Safer:

```markdown
Never copy private keys, tokens, credentials, or `.env` files into prompts, logs, uploads, or diagnostics.
```

Unsafe destructive command:

```bash
rm -rf /tmp/renma-output
```

Safer:

```markdown
Only after explicit human approval, run a scoped cleanup command. Use dry-run where available, keep a backup or rollback path, and verify the affected path before execution.
```

## Security Review Taxonomy

Renma remains a static, compile-time-style scanner. It reads repository text and metadata, emits deterministic findings, and does not become a runtime network blocker, sandbox, or policy enforcement layer.

Security findings may include `riskClass` so reviewers can distinguish clear violations from suspicious patterns and advisory hardening:

- `violation`: a rule or safety contract is broken.
- `suspicious`: risky or ambiguous guidance needs review but is not necessarily a direct violation.
- `advisory`: governance or hardening guidance, such as missing policy metadata.

`riskClass` helps humans triage security review. Runtime network enforcement remains the responsibility of the sandbox, execution environment, MCP server, network policy, or other controls around the agent.

## Security Posture Summaries

Renma can summarize security posture from existing static security findings. The summary groups findings by `riskClass` (`violation`, `suspicious`, `advisory`, and `unclassified`) and by severity, and reports high/critical security finding counts.

This is reporting-only in v1:

- it does not add new detectors
- it does not change scan `fail_on`
- it does not change readiness score or readiness level
- it does not change CI pass/warn/fail status
- it does not enforce runtime network, upload, sandbox, or tool behavior

Runtime enforcement remains outside Renma.

### Effective policy inventory

Renma can also summarize the effective static policy surface across discovered assets. The inventory is derived from asset-local policy metadata, selected `security_profile` chains, and repository-level `security` config.

The inventory reports policy coverage, network/upload/secrets booleans, human approval requirements, approved destinations, forbidden inputs, disallowed commands, and profile resolution counts. It is reporting-only in v1 and does not enforce runtime behavior.

## Common Security Diagnostics

Use this table to choose the right kind of fix. For full finding definitions, see [Diagnostics Reference](diagnostics.md).

| Finding | Usually means | What to change | Fix area |
| --- | --- | --- | --- |
| `SEC-MISSING-POLICY-METADATA` | Sensitive instructions lack a declared policy. | Add local policy fields or select a configured `security_profile`. | Metadata |
| `SEC-INSTRUCTION-VIOLATES-POLICY` | Body text asks for behavior denied by policy. | Rewrite the instruction or adjust policy only after review. | Body text and metadata |
| `SEC-MISSING-HUMAN-APPROVAL-GUARD` | A sensitive action lacks nearby approval wording. | Add explicit human approval close to the action. | Body text |
| `SEC-UNAPPROVED-NETWORK-DESTINATION` | An instruction contacts a host outside approved network destinations. | Use an approved host or update asset/profile/repo network approvals intentionally. | Body text, metadata, or config |
| `SEC-UNAPPROVED-UPLOAD-DESTINATION` | An upload target is not in upload approvals. | Use an approved upload target or update upload approvals intentionally. | Body text, metadata, or config |
| `SEC-FORBIDDEN-INPUT-INSTRUCTION` | The asset asks for data listed in `forbidden_inputs`. | Remove the request or replace it with redaction and placeholder guidance. | Body text and metadata |
| `SEC-SECRET-MATERIAL-INSTRUCTION` | Instructions may expose private keys, tokens, credentials, or secret files. | Remove secret collection or disclosure instructions. | Body text |
| `SEC-DESTRUCTIVE-COMMAND` | A destructive command appears without enough local safety context. | Remove it, scope it tightly, or add explicit approval and recovery guidance. | Body text |
| `SEC-PRIVILEGED-COMMAND-WITHOUT-GUARD` | `sudo` or similar privileged action lacks guardrails. | Add prerequisites, confirmation, rollback, and verification guidance. | Body text |
| `SEC-UNPINNED-REMOTE-SCRIPT` | A remote script is executed without an immutable source or verification. | Pin and verify the source, or avoid remote execution. | Body text |
| `SEC-UNPINNED-DEPENDENCY-INSTALL` | An install example lacks exact version or digest pinning. | Pin package versions or use a reproducible install source. | Body text |
