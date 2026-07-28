# SkillSpector Experiment

This directory is a small, opt-in, non-production environment for evaluating
SkillSpector against existing Renma Skills and examples. It collects evidence
for the candidate
[external-review governance](../../docs/external-review-governance.md)
direction; it is not a production integration, package dependency, CI gate, or
normal Renma verification step.

Renma owns repository identity, declarations, governance, and the possible
future applicability of external evidence. SkillSpector owns its inspection,
native findings, severity, risk calculation, execution coverage, and
limitations. Findings produced here are observations for evaluation, not Renma
findings, and a clean report does not prove that a Skill is safe.

## Prerequisite

SkillSpector installation is external and optional. Install its `skillspector`
executable using an upstream-supported method, then make it available on
`PATH`. Do not add SkillSpector or Python packages to Renma's `package.json`.
The runner uses only Node.js built-in modules.

If an isolated installation is not on `PATH`, set
`RENMA_SKILLSPECTOR_EXECUTABLE` to the exact installed executable path for the
runner invocation.

The default experiment is static-only and requires no API key or LLM. Note that
SkillSpector may still query its documented vulnerability service with
dependency coordinates and may fall back to offline data. Consult
SkillSpector's own documentation for its current network and trust boundary.

The optional LLM path can send inspected content to the configured provider. It
is non-deterministic, must be run separately, and requires the operator to
review the producer's current configuration, credentials, and data-egress
behavior first.

## Targets And Commands

List every configured target without running a scan:

```bash
node experiments/skillspector/run.mjs --list
```

Run the default static-only experiment over canonical Skills:

```bash
node experiments/skillspector/run.mjs --kind canonical-skill
```

Select one target by stable experiment ID:

```bash
node experiments/skillspector/run.mjs --target root-release-prep
```

Run the separately classified repository probes:

```bash
node experiments/skillspector/run.mjs --kind repository-probe
```

Optionally run one LLM-enabled, non-deterministic experiment:

```bash
node experiments/skillspector/run.mjs --target root-release-prep --llm
```

Canonical Skill scans and repository-level probes are deliberately distinct.
An example root is not implied to be one canonical Skill.

## Generated Reports

For each selected target, the runner invokes the already-installed executable
twice so SkillSpector emits both native formats:

```text
experiments/skillspector/generated/<mode>/<target-id>/report.json
experiments/skillspector/generated/<mode>/<target-id>/report.sarif
experiments/skillspector/generated/<mode>/<target-id>/run.json
```

Rerunning the same target and mode replaces its previous local generated
artifacts; the `generated/` directory is not an archive.

`run.json` records the requested mode, captured SkillSpector version when
available, exact argument arrays, target identity, timestamps, native exit
status, and an experiment-only command classification. The raw JSON and SARIF
remain the authoritative producer output; the runner does not parse findings
or reproduce SkillSpector's risk calculation.

The run record keeps four questions separate:

- **Harness execution:** Did the runner start the process and receive every
  newly written report?
- **Producer execution:** Did SkillSpector report that its inspection
  completed?
- **Native assessment:** Did the completed inspection pass SkillSpector's own
  risk threshold?
- **Report availability:** Was the requested raw format actually written?

For the evaluated SkillSpector 2.5.0 behavior, exit `0` with a report is
`completed-threshold-passed`, while exit `1` with a report is
`completed-threshold-not-passed`. Both are completed evidence-collection runs,
so the experiment runner exits successfully. Exit `2` is
`producer-execution-failed`; a report written before that failure is preserved.
Spawn errors and missing reports are `harness-failed`, and any other exit code
is `unsupported-exit-code`. Those classifications make the runner fail closed.
The producer version is stored in each run record so this mapping can be
reevaluated when SkillSpector changes.

The complete `generated/` directory is ignored by Git. Reports are local
artifacts and are not committed by default; a small report should become a
fixture only after a separate deliberate review.

## Experiment Rules

- Do not modify existing Renma assets merely to make SkillSpector pass.
- Do not describe SkillSpector findings as Renma findings.
- Do not generate a baseline or suppression automatically.
- Do not add suppression flags to the runner.
- Accept a suppression only after human review, with its reason recorded
  separately.
- Do not treat a producer score or recommendation as Renma Readiness.
- Keep the experiment out of normal builds, tests, scans, releases, and CI.

Record actual runs using [EVALUATION.md](EVALUATION.md). Preserve what the
producer reported, including partial, skipped, disabled, failed, or unknown
analysis, instead of inferring completion from a favorable outcome.
