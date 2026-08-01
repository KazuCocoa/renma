# SkillSpector Evidence Correlation Experiment

This directory is an isolated, non-production extension of the existing
[SkillSpector experiment](../README.md). It tests only two layers:

1. preservation of scanner-native facts; and
2. deterministic correlation with exact Renma catalog asset paths.

It does not add a Renma command, diagnostic, readiness input, CI policy,
runtime dependency, generic adapter framework, or public schema. SkillSpector's
severity, confidence, score, recommendation, and remediation remain
scanner-native values.

The audited result is in
[`captured/fixture-run/EXPERIMENT-REPORT.md`](captured/fixture-run/EXPERIMENT-REPORT.md).
The experimental JSON projection is deliberately labeled
`renma.experiment.skillspector-evidence.v0` and has no compatibility promise.

## Fixture safety and scope

Committed fixtures are inert `.template` files. Preparation materializes them
only below the already ignored `experiments/skillspector/generated/` tree, so
no committed fixture is a discoverable `SKILL.md` or executable Python asset.
The script contains static patterns but is never imported or executed.

The generated repository and explicit expectations are designed to exercise:

- one governed Skill with an explicit Renma ID and owner;
- one governed, referenced Python script with inherited ownership;
- one scanner-visible README excluded from the Renma fixture globs;
- scanner-native severity and confidence when reported;
- multiple findings per governed asset;
- duplicate findings without merging them; and
- scanner-native location precision, including the captured start-line-only
  case.

The report validates these expectations against each input. Missing findings,
correlations, target cases, expected precision, duplicate structure, successful
execution, or complete analysis produce an inconclusive outcome instead of a
stale positive conclusion. Scanner-native execution and completeness facts
remain distinct from the experiment's preservation and correlation results.

## Reproduce locally

SkillSpector remains an external prerequisite. Build Renma, then run the
experiment with an externally installed executable:

```bash
npm run build
RENMA_SKILLSPECTOR_EXECUTABLE=/path/to/skillspector \
  node experiments/skillspector/evidence-correlation/run-experiment.mjs
```

The disposable run is written under
`experiments/skillspector/generated/evidence-correlation/run/`. It preserves:

- the original SkillSpector JSON report;
- the original Renma catalog JSON used for correlation;
- invocation, fixture-hash, exact harness-hash, Git revision, and dirty-state
  evidence;
- the experimental normalized evidence JSON; and
- a generated human-readable report.

Run the experiment-only tests separately:

```bash
node --test experiments/skillspector/evidence-correlation/lib.test.mjs
```

`--capture` is reserved for deliberately creating one reviewed, committed
evidence run. It refuses to overwrite an existing capture. Ordinary
reproduction should use the ignored default output.

## Provenance model

Every evidence record uses explicit containers:

- `scannerFact` copies the complete native issue unchanged and points back to
  the raw JSON location;
- `normalization` adds a safe repository-relative path and location-precision
  description without overwriting scanner fields; and
- `correlation` records an exact path match, unresolved reason, or ambiguity,
  plus catalog-derived asset, owner, direct Skill association, and dependency
  context.

`directSkillAssociations` is intentionally narrow. A matched Skill associates
to itself with `matched-asset-is-skill`; a non-Skill associates only through a
direct `owns_local_resource` edge with
`direct-owns-local-resource-edge`. The experiment does not infer transitive
reachability, route membership, or general entrypoint association.

Only exact normalized source paths correlate. Missing, unsafe, unmatched, and
ambiguous targets are retained. Duplicate observations never merge records and
are explicitly not stable fingerprints.
