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

The generated repository contains:

- one governed Skill with an explicit Renma ID and owner;
- one governed, referenced Python script with inherited ownership;
- one scanner-visible README excluded from the Renma fixture globs;
- native findings with severity and confidence;
- multiple findings per governed asset;
- exact duplicate findings with distinct scanner-native IDs; and
- start-line-only locations with no reported end line.

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
- invocation and fixture-hash evidence;
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
  plus catalog-derived asset, owner, entrypoint, and dependency context.

Only exact normalized source paths correlate. Missing, unsafe, unmatched, and
ambiguous targets are retained. Duplicate observations never merge records and
are explicitly not stable fingerprints.
