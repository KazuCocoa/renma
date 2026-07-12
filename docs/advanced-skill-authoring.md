# Advanced Skill Authoring

Use this guide when one broad Skill has grown into several distinct workflows
that should remain thin, reviewable, and backed by shared Context Assets.

This is current 0.17.0 authoring guidance. Here, a “router Skill” means a Skill
whose description and body direct a consuming platform toward a bounded
workflow. Renma validates its repository structure and declared Context
relationships; Renma does not select a Skill at runtime.

Proposed 0.18.0 Skill-to-Skill discovery, route metadata, generated indexes,
and routing diagnostics are outside this guide. See
[Proposed 0.18.0 Skill Discovery](../plan-discovery.md).

## Derive A Focused Skill From An Existing Skill

A repository may begin with a broad workflow such as setup, specification
review, regression planning, or test generation. As responsibilities diverge,
prefer separate Skills with explicit selection boundaries over one large Skill
that embeds every variant.

Start by inspecting the existing Skill and its repository relationships:

```bash
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

## Keep Derived Skills Thin

A derived Skill should own:

- when its workflow should and should not be selected;
- required inputs and preflight checks;
- ordered instructions and decision points;
- safety and policy constraints;
- Context relationships; and
- completion and verification criteria.

Reusable domain, product, testing, platform, and tool knowledge should remain in
Context Assets where multiple Skills can depend on it.

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

Generate each new target once:

```bash
renma scaffold skill skills/setup/appium-ios-simulator/SKILL.md \
  --owner mobile-platform
```

Then review and complete it using platform-native Skill authoring guidance. Do
not run another independent generator against the same file.

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
assets. It does not add automatic Skill selection, Skill-to-Skill route
semantics, generated discovery indexes, prompt assembly, or execution.
