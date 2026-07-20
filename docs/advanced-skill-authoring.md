# Advanced Skill Authoring

Use this guide when one broad Skill has grown into several distinct workflows
that should remain focused, reviewable, and backed by appropriate local
resources or shared Context Assets.

This guide builds on the focused-workflow model introduced in 0.18.0. For the
0.19.0 authoring contract, run `renma guide skill` before generating new files.
A focused Skill owns the workflow it needs to execute well; it is not required
to be a thin router. Renma validates repository structure and declared Context
relationships but does not select a Skill at runtime.

The 0.22.0 Skill Discovery foundation adds explicit canonical continuation
metadata and a static graph projection. It remains separate from repository
file and Skill-local support-resource discovery, and it does not add published
entrypoints, repository-wide adoption, reachability, coverage, or runtime Skill
selection. See the [Skill Discovery Graph contract](skill-discovery.md).

## Derive A Focused Skill From An Existing Skill

A repository may begin with a broad workflow such as setup, specification
review, regression planning, or test generation. As responsibilities diverge,
prefer separate Skills with explicit selection boundaries over one large Skill
that embeds every variant.

Because deriving focused Skills intentionally reconsiders asset boundaries,
start by establishing the proposed structure and inspecting the existing Skill
and its repository relationships:

```bash
renma guide skill
renma inspect skills/setup/appium/SKILL.md
renma graph . --focus skill.setup.appium --format mermaid
renma catalog . --format json
```

Use the evidence to answer:

- Which trigger and exclusion boundaries are genuinely different?
- Which instructions and completion criteria are shared?
- Which knowledge should remain in independently owned Context Assets?
- Which owner, policy, dependency, or domain decisions require human input?
- Can the original Skill stay focused, or should its responsibility narrow?

Do not invent a hierarchy merely to make the repository look organized. Create
a new Skill only when its usage boundary and workflow are independently useful.

## Keep Derived Skills Focused

A derived Skill should own:

- when its workflow should and should not be selected;
- required inputs and preflight checks;
- ordered instructions and decision points;
- safety and policy constraints;
- Context relationships; and
- completion and verification criteria.

Domain, product, testing, platform, and tool knowledge should remain in Context
Assets when it is reused across Skills or has an independent owner, lifecycle,
maintenance boundary, source-of-truth role, or another explicit reason for
independent review and governance. Correctness importance alone is not an
independent Context boundary.

Skill-specific detailed procedures and variants belong in local references;
deterministic implementation belongs in scripts; output resources belong in
assets. Ordered workflow steps, read conditions, constraints, and completion
criteria remain in `SKILL.md`.

```text
skills/setup/appium-ios-simulator/SKILL.md
skills/setup/appium-android-emulator/SKILL.md
skills/setup/appium-real-device/SKILL.md

contexts/tools/appium/setup-basics.md
contexts/tools/appium/capabilities.md
contexts/platform/ios/simulator-setup.md
contexts/platform/android/emulator-setup.md
contexts/mobile/real-device-risk.md
```

Use `renma guide skill` to define the smallest graph, then generate each new
target once:

```bash
renma scaffold skill skills/setup/appium-ios-simulator/SKILL.md \
  --owner mobile-platform
```

Then review and complete its semantics using platform-native Skill authoring
guidance within the established Renma boundaries. Do not run another independent
generator against the same file.

## Declare Current Repository Relationships

Use the shipped Context and Context Lens relationship fields. For example:

```yaml
---
name: appium-ios-simulator
description: Prepare Appium for an iOS Simulator. Use for simulator-based iOS setup; do not use for physical-device provisioning.
metadata:
  renma.id: skill.setup.appium-ios-simulator
  renma.title: Appium iOS Simulator Setup
  renma.owner: mobile-platform
  renma.status: experimental
  renma.tags: '["setup","appium","ios"]'
  renma.requires-context: '["context.tools.appium.setup-basics","context.platform.ios.simulator-setup"]'
  renma.optional-context: '["context.tools.appium.capabilities"]'
---
```

`renma.requires-context` records knowledge the workflow normally depends on.
`renma.optional-context` records knowledge needed only for some cases. These are
static repository relationships; they do not load or inject Context at runtime.

When this Skill itself owns a reviewed continuation decision, it may add
`renma.continues-with` as a JSON-array string of exact Skill IDs or
repository-relative `SKILL.md` paths. Keep the conditions and no-match behavior
in the source body; the declaration does not make Renma select or execute the
next Skill. See the [Skill Discovery Graph contract](skill-discovery.md).

Use `renma.conflicts` only when two declared assets should not be used together
without review. Do not use it as a substitute for a clear trigger description.

## Review Selection Boundaries

Renma does not choose among related Skills, so their portable descriptions must
make the distinction reviewable to the consuming platform.

| Situation | Prefer Skill | Boundary |
| --- | --- | --- |
| iOS Simulator setup | `skill.setup.appium-ios-simulator` | Simulator workflow; excludes physical devices |
| Android Emulator setup | `skill.setup.appium-android-emulator` | Emulator workflow; excludes physical devices |
| Real-device setup | `skill.setup.appium-real-device` | Provisioning and device-risk workflow |
| General Appium capability review | A focused capability Skill or Context lookup | Not a platform setup workflow |

For each related Skill, confirm:

- the description states both the positive trigger and important exclusions;
- required inputs distinguish it from nearby workflows;
- shared knowledge is referenced instead of copied;
- completion criteria are specific to the workflow; and
- a human has confirmed ownership, policy, dependencies, and domain behavior.

## Validate And Review

Run the focused and repository-wide checks after authoring:

```bash
renma inspect skills/setup/appium-ios-simulator/SKILL.md
renma graph . --focus skill.setup.appium-ios-simulator --format mermaid
renma catalog . --format markdown
renma scan . --fail-on high
```

Fix relevant diagnostics and rerun the scan. Do not weaken security policy or
add a suppression merely to pass. Have a human review meaningful semantic
changes before merging.

This workflow creates and governs current Agent Skills-compatible repository
assets. It does not automatically add continuation declarations, published
entrypoints, reachability, coverage, prompt assembly, Skill selection, or
execution.
