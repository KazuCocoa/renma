# Interactive Placeholder Example

This small example demonstrates a clarify-before-act interaction described by
a governed Skill. A consuming agent prepares and inspects a disposable file,
asks one focused question when a value is missing, waits, applies the validated
answer with a local CLI, and verifies the result.

A Skill can define a clarify-before-act interaction: inspect the current state,
ask for missing information, wait, and act only after the user supplies it.

## Responsibility Boundary

Renma:

- discovers and validates the Skill and repository assets;
- checks workflow clarity, required inputs, helper-command paths, metadata,
  security policy, and repository structure; and
- provides deterministic scan and readiness evidence.

Renma does not run the interaction, execute the Node.js tool, ask the user,
store conversational state, or resume the workflow.

The consuming agent:

- follows [`skills/replace-placeholder/SKILL.md`](skills/replace-placeholder/SKILL.md);
- runs the fixed local CLI commands;
- notices the missing replacement, asks one question, and waits;
- validates the user's answer before applying it; and
- inspects and reports the result.

The user supplies the missing value, can inspect the resulting file, and
retains final control over it.

## Prerequisites

- Node.js 22 or newer for the local demonstration.
- A built Renma checkout for the `node dist/index.js` inspection commands.
- Run the Renma commands below from the repository root.

## Inspect With Renma

```bash
npm run build
node dist/index.js scan examples/interactive-placeholder --fail-on high
node dist/index.js catalog examples/interactive-placeholder --format markdown
node dist/index.js readiness examples/interactive-placeholder --format markdown
node dist/index.js inspect examples/interactive-placeholder/skills/replace-placeholder/SKILL.md
```

With an installed CLI, the equivalent commands are:

```bash
renma scan examples/interactive-placeholder --fail-on high
renma catalog examples/interactive-placeholder --format markdown
renma readiness examples/interactive-placeholder --format markdown
renma inspect examples/interactive-placeholder/skills/replace-placeholder/SKILL.md
```

## Try The Interaction

Change into the example directory, then prepare and inspect the disposable
output:

```bash
cd examples/interactive-placeholder
node tools/placeholder-demo.mjs prepare
node tools/placeholder-demo.mjs inspect
```

Expected state:

```text
State: waiting for a replacement value (<placeholder> remains).
```

At this boundary, the consuming agent asks for one value matching
`[A-Za-z0-9_-]{1,32}` and waits without modifying the file. After the user
supplies a valid value, for example `Renma_017`, the agent passes it as one
argument and verifies the result:

```bash
node tools/placeholder-demo.mjs apply Renma_017
node tools/placeholder-demo.mjs inspect
```

Expected verification:

```text
State: complete. Hello, Renma_017!
```

Run `node tools/placeholder-demo.mjs prepare` at any time to recreate
`workspace/output.txt` from the immutable `assets/template.txt`. The generated
output is ignored by Git, so repeating the example does not modify a tracked
fixture.

## Intentionally Not Demonstrated

This example does not add a Renma runtime feature, Context Asset, Context Lens,
workflow state machine, platform Plan mode, runtime Skill selection, prompt
assembly, provider integration, agent execution, automatic question asking,
automatic resume, network access, uploads, or repository rewriting. It isolates
one interaction pattern that an external consuming agent can execute from a
statically governed Skill.
