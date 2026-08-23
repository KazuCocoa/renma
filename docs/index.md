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
agent-facing knowledge. It keeps Skills, Context Assets, Context Lenses,
ownership, lifecycle, relationships, security policy, and review evidence
maintainable in Git without becoming an agent runtime.

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

## Product Boundary

Renma discovers, validates, compares, and reports repository assets. It does
not call an LLM for core analysis, assemble prompts, select live context,
execute agents or Skills, or replace runtime security and language-specific
analysis tools.

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
