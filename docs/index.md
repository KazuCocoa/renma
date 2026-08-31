<div class="renma-logo">
  <img
    src="/branding/renma-logo.png"
    alt="Renma"
    width="785"
    height="323"
  />
</div>

# Renma

Renma is a Git-native Context Repository and deterministic governance CLI for
agent-facing knowledge and its static repository declarations. It keeps Skills,
Context Assets, Context Lenses, ownership, lifecycle, provenance, security
policy, declared relationships, and review evidence maintainable in Git. Renma
analyzes and reports repository state; it is not the runtime that consumes
these assets.

## Why A Context Repository?

Agent-facing guidance is often copied across Skills, prompts, and repository
instructions until its authority, owner, and lifecycle are unclear. A Context
Repository gives reusable knowledge stable identity and explicit,
Git-reviewed governance. A Context Asset is the governance entry point for
independently maintained knowledge and its authoritative sources. The content
may live in the Context Repository or in an external governed system; Renma
does not require copying the complete external source into `contexts/`.

A reviewed reference does not prove that the source was consulted or its
contents validated, and it does not grant permission to access the source.

## What Renma Checks

Renma reviews discovered agent-facing repository assets and produces
deterministic evidence for humans, CI, and coding agents. `renma scan` is the
normal starting point; focused commands expose the related inventory, graph,
ownership, readiness, and change evidence.

| Area                             | Examples of what Renma checks or reports                                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Agent Skills and layout          | Canonical entrypoints and metadata shapes, historical paths, reserved-directory boundaries, and repository classification.                                                                                                                                                                                                                                         |
| Governance                       | Stable identity, declared and inherited ownership, lifecycle and freshness, required metadata, and security-profile resolution.                                                                                                                                                                                                                                    |
| Relationships and support        | Missing, inactive, conflicting, or cyclic dependencies; broken references; unreachable Skill support; and inspection blockers such as symlinks, unreadable files, size limits, or depth limits.                                                                                                                                                                    |
| Authoring quality                | Selection boundaries, required inputs, preflight and verification guidance, scaffold residue, machine-local paths, token budgets, and possible mixed responsibilities.                                                                                                                                                                                             |
| Security policy and instructions | Policy alignment for data, network and upload destinations, secrets, forbidden inputs, and human approval; sensitive-data exposure; destructive or privileged commands; risky error suppression; floating dependency or remote-script execution; hidden or untrusted instructions; hierarchy or safeguard bypass; and suspicious Unicode or frontmatter integrity. |
| Review coverage                  | Which expected files were inspected, which supported security-analysis layers ran, and which formats or surfaces remained unsupported, blocked, or not analyzable.                                                                                                                                                                                                 |

Security checks apply to documented, supported forms in agent-facing
instructions and metadata. They do not perform general code SAST, CVE lookup,
dependency-content validation, complete secret scanning of executable code, or
runtime permission enforcement. See the
[Security Policy Guide](security-policy.md) for the effective-policy and
instruction-analysis boundary, and the
[Diagnostics Reference](diagnostics.md) for current finding identifiers and
remediation guidance.

## Product Boundary

Renma discovers, validates, compares, and reports repository assets. It does
not call an LLM for core analysis; select, retrieve, or load live context;
assemble prompts or inject Context; execute agents or Skills; collect runtime
telemetry; or replace runtime security and language-specific analysis tools.

The review boundary is:

```text
LLM proposes. Renma verifies. Human approves.
```

## Quick Start

```bash
npx renma scan . --fail-on high
npx renma catalog . --format markdown
npx renma graph . --format markdown
npx renma readiness . --format markdown
```

## Read Next

- [Documentation Index](README.md) maps each question to its authoritative
  document.
- [User Manual](user-manual.md) contains the authoritative operational metadata
  reference and covers current CLI workflows and commands.
- [Machine-Readable JSON Compatibility](machine-readable-json.md) defines the
  top-level schema identifiers and 1.x compatibility rules for JSON commands.
- [Authoring Guide](authoring-guide.md) defines Skill and Context authoring
  workflows.
- [Changelog](changelog.md) records release history and compatibility notes.
- [Agent Skills Compatibility and Migration](agent-skills-compatibility.md)
  defines canonical and migration-only Skill forms.
- [Diagnostics Reference](diagnostics.md) and
  [Security Policy Guide](security-policy.md) explain findings and policy.

<style scoped>
.renma-logo {
  display: flex;
  justify-content: center;
  margin: 0 0 24px;
  padding: 16px;
  background: #f6f6f7;
  border-radius: 12px;
}

.renma-logo img {
  width: min(100%, 720px);
  height: auto;
}
</style>
