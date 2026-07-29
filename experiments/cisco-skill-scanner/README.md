# Cisco Skill Scanner Experiment

This directory records a non-production evaluation of Cisco Skill Scanner as a
second external-review producer. It collects evidence for
[external-review governance](../../docs/external-review-governance.md); it does
not integrate the scanner with Renma.

Cisco findings remain producer-native observations. They are not Renma
diagnostics, and agreement or disagreement with SkillSpector is not a
correctness judgment.

## External prerequisite

The evaluated scanner is installed outside this repository:

```bash
uv tool install --python 3.13 'cisco-ai-skill-scanner==2.0.12'
```

Version 2.0.12 imports LiteLLM even when no LLM analyzer is selected. LiteLLM
attempts to refresh its model-cost map over the network unless its documented
local-map environment control is set. Every selected report in this experiment
therefore uses:

```bash
LITELLM_LOCAL_MODEL_COST_MAP=True
```

Do not remove that control from the experiment commands. Do not set scanner,
LLM, VirusTotal, or Cisco AI Defense credentials.

## Assessment profiles

`local-core` means:

- `LITELLM_LOCAL_MODEL_COST_MAP=True`;
- no policy flag, so Cisco's built-in `default` policy with `balanced` preset
  base applies;
- the default static, bytecode, and pipeline analyzers;
- no behavioral, trigger, overlap, LLM, meta, VirusTotal, or AI Defense flag;
- no failure-gating flag.

`local-core-plus-behavioral` adds only `--use-behavioral`. Installed-source
inspection confirms that this path performs static AST/dataflow analysis and
constructs behavioral alignment with LLM use disabled.

`local-core-verbose` adds only `--verbose` for a separately classified
repeatability observation. It is not the primary machine-readable profile.

## Controlled corpus

This experiment reuses the exact inert fixture templates maintained by the
historical SkillSpector experiment:

```bash
node experiments/skillspector/prepare-controlled.mjs
node experiments/skillspector/prepare-allowed-tools.mjs
```

The helpers materialize disposable `SKILL.md` files only below
`experiments/skillspector/generated/`. The historical directory name does not
make those fixtures part of SkillSpector's producer contract; reuse permits a
same-corpus comparison. Do not execute the inert Python probe.

## Native report command shape

A selected single-Skill run writes JSON and SARIF from one native scan:

```bash
LITELLM_LOCAL_MODEL_COST_MAP=True /Users/kazu/.local/bin/skill-scanner scan <skill-directory> \
  --format json \
  --format sarif \
  --output-json experiments/cisco-skill-scanner/generated/<profile>/<target>/report.json \
  --output-sarif experiments/cisco-skill-scanner/generated/<profile>/<target>/report.sarif
```

The recursive multi-Skill shape is:

```bash
LITELLM_LOCAL_MODEL_COST_MAP=True /Users/kazu/.local/bin/skill-scanner scan-all <skills-root> \
  --recursive \
  --format json \
  --format sarif \
  --output-json experiments/cisco-skill-scanner/generated/<profile>/<target>/report.json \
  --output-sarif experiments/cisco-skill-scanner/generated/<profile>/<target>/report.sarif
```

Reports and Renma comparison evidence stay below the specifically ignored
`generated/` directory. They are local evidence, not committed fixtures.

See [EVALUATION.md](EVALUATION.md) for exact targets, commands, digests,
contract observations, cross-producer analysis, decision gates, and the final
recommendation.
