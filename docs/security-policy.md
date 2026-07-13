# Renma Security Policy Guide

Use this guide when writing security-sensitive skills or context assets. It is a practical policy-authoring companion to the [User Manual](user-manual.md). For full finding definitions, see the [Diagnostics Reference](diagnostics.md).

Renma security diagnostics are deterministic repository checks for agent-facing operational instructions. They do not execute commands, call an LLM, enforce runtime behavior, inject context, or turn Renma into a broad supply-chain scanner.

## Security Policy Quickstart

Add small security policy metadata to agent-facing Skills or context assets when they include network, upload, secret-handling, command execution, or other sensitive operational instructions. Renma 0.16.0 uses different serialization boundaries for Skills and non-Skill assets.

### Canonical Skill security policy

Operational Skills must be specification-valid Agent Skills. Put every Renma
security field under `metadata` as a flat `renma.*` string entry. Boolean values
are the exact strings `"true"` or `"false"`; lists are JSON-array strings
containing strings only:

```yaml
---
name: local-triage
description: Review local diagnostics safely. Use when repository-local failure evidence needs deterministic security review.
metadata:
  renma.id: skill.diagnostics.local-triage
  renma.owner: qa-platform
  renma.status: stable
  renma.allowed-data: '["repo-local-files","sanitized-ci-diagnostics"]'
  renma.network-allowed: "true"
  renma.external-upload-allowed: "false"
  renma.secrets-allowed: "false"
  renma.requires-human-approval: "true"
  renma.forbidden-inputs: '["secrets","credentials","tokens"]'
---
```

Canonical list fields also include
`renma.approved-network-destinations` and
`renma.approved-upload-destinations`. Invalid recognized canonical values fail
closed: Renma reports their exact evidence, preserves already-reviewed
restrictive inherited policy when that is safer, and prevents permissive
inheritance. Invalid allowed-data permissions remain unresolved, invalid
forbidden-input declarations do not remove inherited restrictions, and invalid
destination allowlists do not disable destination validation.

Asset-local explicit denials remain stricter than inherited profile or
repository allowances. For example, `renma.external-upload-allowed: "false"`
still blocks upload instructions even if a selected profile or repository
config allows uploads elsewhere.

### Non-Skill security policy

Contexts and other non-Skill assets retain the existing top-level syntax:

```yaml
---
id: context.diagnostics.local-triage
allowed_data:
  - repo-local-files
  - sanitized-ci-diagnostics
network_allowed: true
external_upload_allowed: false
secrets_allowed: false
requires_human_approval: true
forbidden_inputs:
  - secrets
  - credentials
  - tokens
approved_network_destinations:
  - github.com
approved_upload_destinations: []
security_profile: local-ci-diagnostics
---
```

These top-level fields are operational only for non-Skill assets. Pre-0.16
top-level Skill security fields are accepted only by `suggest-metadata` as
one-way migration input; normal scan consumers do not use them as Skill policy.

### Allowed data vocabulary

For Skills, `renma.allowed-data` describes the allowed input categories. For
non-Skill assets, the equivalent field is `allowed_data`. This vocabulary is
not a strict closed enum: projects may define their own
data-source categories when they need domain-specific names. Prefer descriptive,
stable values so humans, diagnostics, trust graph output, readiness checks, and
future automation can reason about declared data boundaries consistently.

Recommended vocabulary:

| Value | Meaning |
| --- | --- |
| `repo-local-files` | Files inside the target repository or scan root. |
| `skill-bundled-context` | Context files bundled with or explicitly declared by the skill. |
| `referenced-authenticated-internal-docs` | Authenticated internal documents explicitly referenced by the skill or its context assets. |
| `sanitized-ci-diagnostics` | CI logs, test results, and failure diagnostics that have been sanitized or redacted before being provided to the LLM. |
| `public-docs` | Publicly available documentation, specifications, or references. |
| `disclosed-user-provided-data` | Data explicitly provided or disclosed by the user for the current task. |

Important: allowed-data metadata does not grant broad access to all matching data. For
example, `referenced-authenticated-internal-docs` means authenticated internal
documents that are explicitly referenced by the skill or its context assets. It
does not mean that the skill may freely search all internal documents.

Legacy or coarse values such as `public` and `disclosed` are still accepted, but
prefer values such as `public-docs` and `disclosed-user-provided-data` in new or
updated assets.

Common patterns:

Basic repo-local Skill:

```yaml
metadata:
  renma.allowed-data: '["repo-local-files","skill-bundled-context"]'
```

Internal-doc-backed review skill:

```yaml
metadata:
  renma.allowed-data: '["repo-local-files","skill-bundled-context","referenced-authenticated-internal-docs"]'
```

CI failure diagnosis skill:

```yaml
metadata:
  renma.allowed-data: '["repo-local-files","sanitized-ci-diagnostics"]'
```

OSS or public documentation skill:

```yaml
metadata:
  renma.allowed-data: '["repo-local-files","public-docs"]'
```

User-provided input skill:

```yaml
metadata:
  renma.allowed-data: '["disclosed-user-provided-data","skill-bundled-context"]'
```

### Reusable security profiles

Use a security profile when many assets share the same policy, a team wants a reusable security contract, or policy should be centrally updated in `renma.config.json`.

Configure profiles under `security.profiles`:

```json
{
  "security": {
    "profiles": {
      "local-ci-diagnostics": {
        "allowedData": ["repo-local-files", "sanitized-ci-diagnostics"],
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

Select the profile from a Skill with canonical metadata:

```yaml
---
name: local-triage
description: Review local diagnostics safely. Use when repository-local failure evidence needs deterministic security review.
metadata:
  renma.security-profile: local-ci-diagnostics
---
```

For a non-Skill asset, use the existing top-level
`security_profile: local-ci-diagnostics` field.

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
- Use `renma.security-profile` for a Skill or top-level `security_profile` for a non-Skill asset when selecting reusable team contracts.
- Use repository-level security config for common approved network destinations, upload destinations, or disallowed commands that apply broadly.

If settings disagree, keep the stricter effective policy. Do not relax asset-local denials through a profile or repository allowance.

### Human approval semantics

For a Skill, `renma.requires-human-approval: "true"` requires explicit nearby
approval wording for sensitive actions. The non-Skill equivalent is top-level
`requires_human_approval: true`. Dry-run, backup, rollback, or restore guidance
is useful, but it does not replace explicit approval when approval is required.

Keep approval wording close to the action it guards, especially for uploads, external sharing, privileged commands, destructive commands, or secret-handling workflows.

### Network approval vs upload approval

`approvedDomains` does not imply upload approval. Network access and upload permission are separate decisions.

For Skills, use `renma.approved-network-destinations` and
`renma.approved-upload-destinations` JSON-array strings. For non-Skill assets,
use top-level `approved_network_destinations` and
`approved_upload_destinations`. Profile `approvedDomains` and
`approvedUploadDomains`, and repository `security.approvedDomains` and
`security.approvedUploadDomains`, keep their existing config syntax.

### Forbidden inputs

Use `renma.forbidden-inputs` for a Skill and top-level `forbidden_inputs` for a
non-Skill asset to name data classes it must not request, copy, upload,
summarize, or include in prompts. Common examples are `secrets`, `credentials`,
`tokens`, `private keys`, `.env files`, customer data, and production logs.

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

This is reporting-only in the v2 contract:

- it does not add new detectors
- it does not change scan `fail_on`
- it does not change readiness score or readiness level
- it does not change CI pass/warn/fail status
- it does not enforce runtime network, upload, sandbox, or tool behavior

Runtime enforcement remains outside Renma.

### Effective policy inventory

Renma can also summarize the effective static policy surface across discovered assets. The inventory distinguishes assets with local metadata, inherited policy, effective policy, and no effective policy.

Script and asset bytes never declare local policy. Skill-local scripts and
assets inherit policy only from one unambiguous owning Skill. Text scripts may
be scanned under that inherited policy from line 1; ordinary output assets and
binary files never contribute instruction text. Orphan scripts do not receive
policy-dependent evaluation from repository configuration without an owning
Skill and traceable inheritance evidence.

The inventory reports local, inherited, effective, and missing-effective coverage; network/upload/secrets booleans; human approval requirements; approved destinations; forbidden inputs; disallowed commands; and profile resolution counts. It is reporting-only in v2 and does not enforce runtime behavior.

`renma trust-graph` also includes effective policy evidence. Each effective policy node uses a deterministic fingerprint over normalized allowed data, forbidden inputs, network/upload/secrets booleans, human approval requirement, approved destinations, and disallowed commands. Every `has_effective_policy` edge carries a deterministic `policySources` array containing each source that contributed to the fingerprint: `local`, `security_profile`, `repository_config`, and/or `owning_skill`. Owning-Skill inheritance retains `inheritedFrom`, and selected-profile evidence retains the selected profile and profile chain. The graph does not enforce policy at runtime.

### Security-aware semantic diff

`renma diff` and `renma ci-report` can summarize how security posture and effective security policy inventory changed between two revisions.

The diff uses existing static findings and existing policy metadata/config summaries. It does not add new detectors, change runtime behavior, change scan `fail_on`, change readiness scoring, or change CI pass/warn/fail status.

## Common Security Diagnostics

Use this table to choose the right kind of fix. For full finding definitions, see [Diagnostics Reference](diagnostics.md).

| Finding | Usually means | What to change | Fix area |
| --- | --- | --- | --- |
| `SEC-INVALID-CANONICAL-POLICY-METADATA` | A recognized Skill `metadata.renma.*` security value has an invalid encoding. | Confirm the intended policy, then replace it with the exact documented string encoding; do not guess a permissive value. | Skill metadata |
| `SEC-MISSING-POLICY-METADATA` | Sensitive instructions lack a declared policy. | Add local policy fields or select a configured security profile using the syntax for that asset kind. | Metadata |
| `SEC-INSTRUCTION-VIOLATES-POLICY` | Body text asks for behavior denied by policy. | Rewrite the instruction or adjust policy only after review. | Body text and metadata |
| `SEC-MISSING-HUMAN-APPROVAL-GUARD` | A sensitive action lacks nearby approval wording. | Add explicit human approval close to the action. | Body text |
| `SEC-UNAPPROVED-NETWORK-DESTINATION` | An instruction contacts a host outside approved network destinations. | Enumerate the actual required domains in asset/profile/repo network approvals after review. | Body text, metadata, or config |
| `SEC-UNAPPROVED-UPLOAD-DESTINATION` | An upload target is not in upload approvals. | Use an approved upload target or update upload approvals intentionally. | Body text, metadata, or config |
| `SEC-FORBIDDEN-INPUT-INSTRUCTION` | The asset asks for data listed in its forbidden-input policy. | Remove the request or replace it with redaction and placeholder guidance. | Body text and metadata |
| `SEC-SECRET-MATERIAL-INSTRUCTION` | Instructions may expose private keys, tokens, credentials, or secret files. | Remove secret collection or disclosure instructions. | Body text |
| `SEC-DESTRUCTIVE-COMMAND` | A destructive command appears without enough local safety context. | Remove it, scope it tightly, or add explicit approval and recovery guidance. | Body text |
| `SEC-PRIVILEGED-COMMAND-WITHOUT-GUARD` | `sudo` or similar privileged action lacks guardrails. | Add prerequisites, confirmation, rollback, and verification guidance. | Body text |
| `SEC-UNPINNED-REMOTE-SCRIPT` | A remote script is executed without an immutable source or verification. | Pin and verify the source, or avoid remote execution. | Body text |
| `SEC-UNPINNED-DEPENDENCY-INSTALL` | An install example lacks exact version or digest pinning. | Pin package versions or use a reproducible install source. | Body text |
