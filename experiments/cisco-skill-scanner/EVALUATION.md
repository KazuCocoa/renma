# Cisco Skill Scanner Second-Producer Evaluation

## Outcome

Cisco Skill Scanner 2.0.12 provides readable JSON and SARIF, direct logical
Skill names and paths in JSON, actual enabled-analyzer names, native findings,
a policy identity and fingerprint, timestamps, duration, and a native
high/critical-based `is_safe` assessment. Those are useful common concepts
across two producers.

The native contract is not sufficient for exact external-review governance:
JSON has no producer or report-schema version, SARIF incorrectly reports tool
version `1.0.0`, neither format exposes a complete reviewed-file inventory or
component hashes, and no producer-native completeness ledger distinguishes
planned, disabled, skipped, failed, and not-applicable work. The unqualified
default CLI also performs an import-time LiteLLM network attempt before any
optional analyzer is selected.

Recommendation: **perform a non-production two-producer receipt-design
spike**. The spike should document a compact conceptual projection from the two
native reports, preserve unknown and incompatible semantics, and stop before
implementation. This evaluation does not implement that recommendation.

## Experiment boundary

This is evidence collection only. It adds no Cisco dependency, scanner
integration, adapter, receipt schema, generic SDK or registry, Renma metadata,
CLI or configuration field, BOM change, public schema, manifest contract, CI
execution, LLM analysis, cloud analysis, VirusTotal analysis, upload, or
network-enabled primary scan.

All Cisco reports, materialized controlled Skills, and generated Renma reports
are ignored. Producer-native findings remain separate from Renma diagnostics.

## Repository and evaluation state

| Evidence | Value |
| --- | --- |
| Evaluation date | 2026-07-28 in `America/Los_Angeles`; native report timestamps are UTC on 2026-07-29 |
| Renma origin | `git@github.com:KazuCocoa/renma.git` |
| Renma revision | `d341905ea00648d5e3e2696905008564d2cb6e0e` |
| Revision provenance | latest merged `origin/main`, containing PR #141 |
| Renma version | `0.25.3` |
| Initial Renma branch | `main` |
| Initial Renma dirty state | clean |
| Experiment branch | `cisco-skill-scanner-second-producer` |
| Appium origin | `git@github.com:appium/skills.git` |
| Appium revision | `86bb4cdf59f6aa21e5d8d179058333e5a00d1f72` |
| Appium dirty state before scans | `?? view.md` |

The pre-existing Appium `view.md` remained untouched. Because that checkout was
dirty, this evaluation does not claim commit-exact freshness even though the
recorded revision is useful coarse provenance.

## Producer verification and installation

The official [PyPI project](https://pypi.org/project/cisco-ai-skill-scanner/)
listed 2.0.12, published 2026-06-24, as the latest stable release at evaluation
time. The exact distribution package is `cisco-ai-skill-scanner`. Its metadata
declares `Requires-Python: >=3.10`, classifiers for Python 3.10 through 3.13,
and no upper bound. This evaluation selected a classified Python 3.13 runtime.

PyPI's trusted-publishing attestation binds the 2.0.12 source distribution to
upstream commit
[`605afdc5c7ea887c07e2afeb0fadc1452c07bfa7`](https://github.com/cisco-ai-defense/skill-scanner/tree/605afdc5c7ea887c07e2afeb0fadc1452c07bfa7).
The official [GitHub tags](https://github.com/cisco-ai-defense/skill-scanner/tags)
ended at 2.0.11, and `git ls-remote` found neither `refs/tags/2.0.12` nor
`refs/tags/v2.0.12`; therefore the attested commit, not an invented tag, is the
recoverable upstream revision. Upstream `main` was
`41fec4a9570ba1d195d12dbb0b4d140a35e63068` when checked and is not the
evaluated package revision.

Exact installation:

```bash
uv tool install --python 3.13 'cisco-ai-skill-scanner==2.0.12'
```

Installation receipt:

| Evidence | Value |
| --- | --- |
| Executable | `/Users/kazu/.local/bin/skill-scanner` |
| Resolved executable | `/Users/kazu/.local/share/uv/tools/cisco-ai-skill-scanner/bin/skill-scanner` |
| Tool environment | `/Users/kazu/.local/share/uv/tools/cisco-ai-skill-scanner` |
| Python | `3.13.14` |
| Package version | `2.0.12` |
| Installed source | `/Users/kazu/.local/share/uv/tools/cisco-ai-skill-scanner/lib/python3.13/site-packages/skill_scanner` |
| Distribution metadata | `/Users/kazu/.local/share/uv/tools/cisco-ai-skill-scanner/lib/python3.13/site-packages/cisco_ai_skill_scanner-2.0.12.dist-info` |
| Installed `RECORD` SHA-256 | `fd8b47ad69e523603bd24ea8e35b92d2552aa6b7bd3b7be342713b921610c3bf` |

The following probes were inspected before primary scans:

```bash
/Users/kazu/.local/bin/skill-scanner --version
/Users/kazu/.local/bin/skill-scanner --help
/Users/kazu/.local/bin/skill-scanner scan --help
/Users/kazu/.local/bin/skill-scanner scan-all --help
/Users/kazu/.local/bin/skill-scanner list-analyzers
uv tool list --show-paths
```

`--version` returned `skill-scanner 2.0.12`.

## Analyzer, policy, network, and exit contract

Installed source and `list-analyzers` agree on the default analyzers:

| Analyzer | Default | Locality and experiment use |
| --- | --- | --- |
| static | yes | local YAML, Python checks, and YARA; selected |
| bytecode | yes | local `.pyc` integrity checks; selected |
| pipeline | yes | local command/pipeline taint checks; selected |
| behavioral | no | local static AST/dataflow; selected only with `--use-behavioral` |
| trigger | no | local description-specificity analysis; not selected |
| LLM | no | external model call; not selected |
| meta | no | second-pass LLM call; not selected |
| VirusTotal | no | VirusTotal API and optional upload; not selected |
| AI Defense | no | Cisco AI Defense cloud request; not selected |
| cross-Skill overlap | no | local, `scan-all --check-overlap`; not selected |

No Cisco telemetry, analytics, package update check, content upload, cloud call,
or external service is enabled by a scanner analyzer without an explicit
flag. However, that statement is not enough to call the default executable
offline:

1. The first unqualified default scan imported LiteLLM.
2. LiteLLM attempted a GET of
   `https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`.
3. The sandbox blocked DNS/network access; LiteLLM logged the failure and used
   its bundled backup. No scanned content was part of that cost-map request.
4. Installed LiteLLM source documents
   `LITELLM_LOCAL_MODEL_COST_MAP=True` as the control that prevents the fetch.
5. Every selected report below was overwritten by a fresh run with that
   control active and no network-attempt warning.

Thus Cisco's default analyzer set is local, but version 2.0.12's default CLI
startup is not offline-clean. `local-core` includes the LiteLLM environment
control as a required trust-boundary argument.

With no policy flag, `ScanPolicy.default()` loads `default_policy.yaml`:
policy name `default`, policy version `1.0`, preset base `balanced`, with
static, bytecode, and pipeline enabled. Primary JSON exposed policy fingerprint
`90696022f7fc8c307edfd13e2d4713f9d14042a147f48a3c7c7fde921dc2a686`.
`--verbose` re-enables two output-policy settings and therefore produced the
distinct fingerprint
`25242d2ac2fcd8cff3701cbc189b718525e36aad24a358d6997ae5d380d159f5`.

CLI and source exit semantics are:

- successful scanning returns `0` regardless of findings when no failure gate
  is selected;
- `--fail-on-findings` is shorthand for high severity and
  `--fail-on-severity <level>` returns `1` when the threshold is met;
- missing targets, load failures, no discovered Skills, and other handled scan
  errors return `1`;
- invalid argparse usage uses argparse's standard exit `2`.

Every selected evidence run used no failure-gating flag and returned `0`.
Gating behavior was inspected in source but not executed.

## Assessment profiles

| Profile | Exact additional environment and flags | Actual enabled analyzers |
| --- | --- | --- |
| `local-core` | `LITELLM_LOCAL_MODEL_COST_MAP=True`; no optional analyzer, policy, lenient, overlap, or gating flag | `static_analyzer`, `bytecode`, `pipeline` |
| `local-core-plus-behavioral` | `local-core` plus `--use-behavioral` | core set plus `behavioral_analyzer` |
| `local-core-verbose` | `local-core` plus `--verbose` | same analyzers as `local-core`; different output-policy fingerprint |

No cloud credentials were set. The experiment did not use `--use-llm`,
`--enable-meta`, `--use-aidefense`, `--use-virustotal`, `--vt-upload-files`,
`--use-trigger`, `--check-overlap`, custom rules, or additional rule packs.

## Exact command forms

All commands in this section ran from the Renma repository root. The following
exact batch enumerates every selected `local-core` single-Skill target and
output path; the loop is only command factoring, not a target glob:

```bash
while IFS='|' read -r source output; do
  LITELLM_LOCAL_MODEL_COST_MAP=True /Users/kazu/.local/bin/skill-scanner scan "$source" \
    --format json \
    --format sarif \
    --output-json "$output/report.json" \
    --output-sarif "$output/report.sarif"
done <<'TARGETS'
experiments/skillspector/generated/controlled-fixture/source/intentional-positive|experiments/cisco-skill-scanner/generated/local-core/controlled-intentional-positive
experiments/skillspector/generated/controlled-fixture/source/link-false-positive|experiments/cisco-skill-scanner/generated/local-core/controlled-link-false-positive
experiments/skillspector/generated/controlled-fixture/source/clean-control|experiments/cisco-skill-scanner/generated/local-core/controlled-clean-control
experiments/skillspector/generated/allowed-tools/repositories/no-declaration/skills/no-declaration|experiments/cisco-skill-scanner/generated/local-core/allowed-no-declaration
experiments/skillspector/generated/allowed-tools/repositories/single-read/skills/single-read|experiments/cisco-skill-scanner/generated/local-core/allowed-single-read
experiments/skillspector/generated/allowed-tools/repositories/single-webfetch/skills/single-webfetch|experiments/cisco-skill-scanner/generated/local-core/allowed-single-webfetch
experiments/skillspector/generated/allowed-tools/repositories/standard-multi-tool/skills/standard-multi-tool|experiments/cisco-skill-scanner/generated/local-core/allowed-standard-multi-tool
experiments/skillspector/generated/allowed-tools/repositories/standard-qualified-tools/skills/standard-qualified-tools|experiments/cisco-skill-scanner/generated/local-core/allowed-standard-qualified-tools
experiments/skillspector/generated/allowed-tools/repositories/producer-comma-contrast/skills/producer-comma-contrast|experiments/cisco-skill-scanner/generated/local-core/allowed-producer-comma-contrast
experiments/skillspector/generated/allowed-tools/repositories/docs-only-standard/skills/docs-only-standard|experiments/cisco-skill-scanner/generated/local-core/allowed-docs-only-standard
skills/release-prep|experiments/cisco-skill-scanner/generated/local-core/renma-release-prep
examples/context-repo/skills/testing/spec-review|experiments/cisco-skill-scanner/generated/local-core/renma-spec-review
/Users/kazu/github/skills/skills/appium-troubleshooting|experiments/cisco-skill-scanner/generated/local-core/appium-appium-troubleshooting
/Users/kazu/github/skills/skills/prepare-development-environment|experiments/cisco-skill-scanner/generated/local-core/appium-prepare-development-environment
/Users/kazu/github/skills/skills/setup|experiments/cisco-skill-scanner/generated/local-core/appium-setup
/Users/kazu/github/skills/skills/setup-chromium|experiments/cisco-skill-scanner/generated/local-core/appium-setup-chromium
/Users/kazu/github/skills/skills/setup-espresso|experiments/cisco-skill-scanner/generated/local-core/appium-setup-espresso
/Users/kazu/github/skills/skills/setup-gecko|experiments/cisco-skill-scanner/generated/local-core/appium-setup-gecko
/Users/kazu/github/skills/skills/setup-mac2|experiments/cisco-skill-scanner/generated/local-core/appium-setup-mac2
/Users/kazu/github/skills/skills/setup-safari|experiments/cisco-skill-scanner/generated/local-core/appium-setup-safari
/Users/kazu/github/skills/skills/setup-uiautomator2|experiments/cisco-skill-scanner/generated/local-core/appium-setup-uiautomator2
/Users/kazu/github/skills/skills/setup-xcuitest|experiments/cisco-skill-scanner/generated/local-core/appium-setup-xcuitest
/Users/kazu/github/skills/skills/xcuitest-real-device-config|experiments/cisco-skill-scanner/generated/local-core/appium-xcuitest-real-device-config
TARGETS
```

The two unchanged combined-corpus runs were:

```bash
LITELLM_LOCAL_MODEL_COST_MAP=True /Users/kazu/.local/bin/skill-scanner scan-all experiments/skillspector/generated/controlled-fixture/source/combined --recursive --format json --format sarif --output-json experiments/cisco-skill-scanner/generated/local-core/controlled-combined-run-1/report.json --output-sarif experiments/cisco-skill-scanner/generated/local-core/controlled-combined-run-1/report.sarif
LITELLM_LOCAL_MODEL_COST_MAP=True /Users/kazu/.local/bin/skill-scanner scan-all experiments/skillspector/generated/controlled-fixture/source/combined --recursive --format json --format sarif --output-json experiments/cisco-skill-scanner/generated/local-core/controlled-combined-run-2/report.json --output-sarif experiments/cisco-skill-scanner/generated/local-core/controlled-combined-run-2/report.sarif
```

The separately classified verbose runs were:

```bash
LITELLM_LOCAL_MODEL_COST_MAP=True /Users/kazu/.local/bin/skill-scanner scan-all experiments/skillspector/generated/controlled-fixture/source/combined --recursive --verbose --format json --format sarif --output-json experiments/cisco-skill-scanner/generated/local-core-verbose/controlled-combined-run-1/report.json --output-sarif experiments/cisco-skill-scanner/generated/local-core-verbose/controlled-combined-run-1/report.sarif
LITELLM_LOCAL_MODEL_COST_MAP=True /Users/kazu/.local/bin/skill-scanner scan-all experiments/skillspector/generated/controlled-fixture/source/combined --recursive --verbose --format json --format sarif --output-json experiments/cisco-skill-scanner/generated/local-core-verbose/controlled-combined-run-2/report.json --output-sarif experiments/cisco-skill-scanner/generated/local-core-verbose/controlled-combined-run-2/report.sarif
```

The separately classified behavioral comparison was:

```bash
while IFS='|' read -r source output; do
  LITELLM_LOCAL_MODEL_COST_MAP=True /Users/kazu/.local/bin/skill-scanner scan "$source" \
    --use-behavioral \
    --format json \
    --format sarif \
    --output-json "$output/report.json" \
    --output-sarif "$output/report.sarif"
done <<'TARGETS'
experiments/skillspector/generated/allowed-tools/repositories/no-declaration/skills/no-declaration|experiments/cisco-skill-scanner/generated/local-core-plus-behavioral/allowed-no-declaration
experiments/skillspector/generated/allowed-tools/repositories/standard-multi-tool/skills/standard-multi-tool|experiments/cisco-skill-scanner/generated/local-core-plus-behavioral/allowed-standard-multi-tool
experiments/skillspector/generated/allowed-tools/repositories/producer-comma-contrast/skills/producer-comma-contrast|experiments/cisco-skill-scanner/generated/local-core-plus-behavioral/allowed-producer-comma-contrast
TARGETS
```

The Appium multi-Skill command was:

```bash
LITELLM_LOCAL_MODEL_COST_MAP=True /Users/kazu/.local/bin/skill-scanner scan-all /Users/kazu/github/skills/skills --recursive --format json --format sarif --output-json experiments/cisco-skill-scanner/generated/local-core/appium-all/report.json --output-sarif experiments/cisco-skill-scanner/generated/local-core/appium-all/report.sarif
```

No repository-root scan was run: source inspection shows recursive discovery
is `SKILL.md` discovery, so scanning `/Users/kazu/github/skills` would find the
same 11 Skills without adding a repository-level scope contract.

Current Renma evidence was generated separately:

```bash
node dist/index.js catalog <repository> --format json
node dist/index.js bom <repository> --format json --omit-generated-at
node dist/index.js scan <repository> --format json
```

The three repositories were `.`, `examples/context-repo`, and the read-only
`/Users/kazu/github/skills`. Outputs stayed below the Cisco generated root.

## Controlled finding behavior

The exact templates from `experiments/skillspector/fixtures/` were materialized
with the existing helpers. They were not copied or semantically changed for
Cisco.

| Target | Cisco `local-core` result | Interpretation |
| --- | --- | --- |
| intentional positive | one `MANIFEST_MISSING_LICENSE` INFO; `is_safe: true` | Cisco did not report SkillSpector's intentional Agent Snooping concern; different producer coverage |
| benign Markdown link | one `MANIFEST_MISSING_LICENSE` INFO; `is_safe: true` | Cisco did not report the link cause or duplicate it |
| clean control | one `MANIFEST_MISSING_LICENSE` INFO; `is_safe: true` | not a zero-finding report because Cisco treats absent per-Skill license as INFO |
| combined corpus | four Skills discovered, each with the same license INFO; all safe | recursive discovery included the linked nested Skill as a fourth subject |

The combined root itself is not a valid single Skill. A preliminary `scan`
correctly returned `1` with `SKILL.md not found`; the selected repeatability
runs use documented recursive `scan-all`.

Cisco's license finding is a producer-specific policy concern. The fixture
remains a valid controlled comparison; the experiment does not modify it to
silence either producer.

## `allowed-tools` and behavioral comparison

| Case | Cisco `local-core` native rules beyond missing license | Observation |
| --- | --- | --- |
| no declaration | `TOOL_ABUSE_UNDECLARED_NETWORK` | empty `allowed-tools` disables Cisco's mismatch checks, but an independent static consistency rule reports network use |
| single `Read` | `ALLOWED_TOOLS_NETWORK_USAGE`, `TOOL_ABUSE_UNDECLARED_NETWORK` | file read is accepted; network is reported |
| single `WebFetch` | `ALLOWED_TOOLS_READ_VIOLATION`, `ALLOWED_TOOLS_NETWORK_USAGE`, `TOOL_ABUSE_UNDECLARED_NETWORK` | file-read mismatch is direct evidence of declaration interpretation |
| standard `Read WebFetch` | `ALLOWED_TOOLS_NETWORK_USAGE`, `TOOL_ABUSE_UNDECLARED_NETWORK` | space-separated standard syntax is tokenized; Cisco states network is not controlled by `allowed-tools` |
| qualified selectors | `ALLOWED_TOOLS_NETWORK_USAGE`, `TOOL_ABUSE_UNDECLARED_NETWORK` | `Read` is recognized; no Bash behavior exists to test qualified Bash matching |
| comma contrast | `ALLOWED_TOOLS_NETWORK_USAGE`, `TOOL_ABUSE_UNDECLARED_NETWORK` | installed source deliberately accepts comma-separated strings as well as spaces |
| docs-only standard | no rule beyond missing license | no probe means no capability finding |

Installed source shows the mismatch logic uses static text patterns and never
executes the probe. It explicitly returns no mismatch findings when the
declaration is absent, splits standard space-delimited strings, and also
accepts the non-standard comma form.

Adding `--use-behavioral` to `no-declaration`, standard `Read WebFetch`, and the
comma contrast changed `analyzers_used` but added no findings. The existing
static rules, not the behavioral analyzer, detected the inert network pattern.
No report exposes applicability, planned behavioral work, or a statement that
the file-read path was analyzed. Absence of a behavioral finding is therefore
not evidence that behavioral analysis interpreted `allowed-tools`.

Compared with SkillSpector, the two producers attach incompatible semantics to
the same field. SkillSpector reported LP3 for no declaration, LP1 network for
single `Read`, LP1 file-read for single `WebFetch`, both LP1 capabilities for
the standard space-delimited multi-tool and qualified cases, and no issues for
the comma contrast. Cisco recognizes the Agent Skills standard string but
treats network as outside `allowed-tools`; SkillSpector 2.5.0's permission
model favored its comma-compatible form. Rule IDs are not translated.

## Canonical Renma Skills

Both targets were accepted in strict/default parsing without `--lenient`:

| Target | Cisco logical name | Cisco finding | Renma public identity |
| --- | --- | --- | --- |
| `skills/release-prep` | `release-prep` | missing license INFO | `skill.release-prep`; `skills/release-prep/SKILL.md`; `sha256:03d7322b650e971dedfffa9e3c3bae5a4611f47dc6253bf8ceb5c5a97602491c` |
| `examples/context-repo/skills/testing/spec-review` | `spec-review` | missing license INFO | `skill.testing.spec-review`; `skills/testing/spec-review/SKILL.md`; `sha256:03f46e5f699611219d6caad7c331f5bff6d819b572a608998659829834a242cc` |

Each target currently contains only `SKILL.md`. Installed loader source
recursively selects all files under a Skill root, including support files, but
native JSON does not emit that inventory. JSON reports the logical name and
absolute Skill path. SARIF reports only finding locations. No malformed or
unsupported Renma metadata was reported, and no lenient observation was
needed.

Logical-subject binding is **exact** for these two current subjects: the native
name and path agree with Renma's catalog identity. Reviewed-scope binding is
**partial**: the current file set is externally observable, but Cisco native
evidence neither enumerates a complete file set nor binds content hashes.

## Appium Skills corpus

`scan-all /Users/kazu/github/skills/skills --recursive` discovered and scanned
11 Skills. This equals the 11 current canonical Agent Skills reported by Renma.
Every individual strict/default scan also succeeded without lenient mode.

| Skill | Files externally present under Skill root | Cisco result |
| --- | ---: | --- |
| `appium-troubleshooting` | 1 | missing license INFO |
| `prepare-development-environment` | 1 | missing license INFO |
| `setup` | 1 | missing license INFO |
| `setup-chromium` | 2 | missing license INFO |
| `setup-espresso` | 2 | missing license INFO |
| `setup-gecko` | 2 | missing license INFO |
| `setup-mac2` | 2 | missing license INFO |
| `setup-safari` | 2 | missing license INFO |
| `setup-uiautomator2` | 2 | missing license INFO |
| `setup-xcuitest` | 2 | missing license INFO |
| `xcuitest-real-device-config` | 1 | missing license INFO |

The second file in each two-file Skill is `agents/openai.yaml`. Loader source
selects it, but JSON and SARIF do not prove that selection. The aggregate JSON
contains 11 per-Skill names and absolute roots, total scanned count 11,
`safe_skills: 11`, and 11 INFO findings. It has no multi-scan invocation root,
complete file inventory, exclusions, or hashes.

Logical-subject binding is **exact** for each individual Skill name/path and
**partial** for the aggregate root because the report has no explicit root
subject. Reviewed-scope binding is **partial** for all scans. Renma catalog and
BOM provide repository-relative Skill paths and hashes, but Cisco provides no
component hashes to join, and BOM does not represent the seven
`agents/openai.yaml` support files as assets. The dirty checkout prevents a
commit-exact freshness claim.

## Native JSON and SARIF contract

Single-Skill JSON keys are:

```text
skill_name, skill_path, is_safe, max_severity, findings_count, findings,
scan_duration_seconds, duration_ms, analyzers_used, timestamp, scan_metadata
```

Aggregate JSON wraps the same result objects in `summary` and `results`.
`skills_skipped` appears only when non-empty. Native JSON has no report-schema
version and no producer name or version.

SARIF declares version 2.1.0. It provides rules, results, invocation
`executionSuccessful`, a second-precision end time, locations, and a
`primaryLocationLineHash` fingerprint copied from the JSON finding ID. Its
driver name is `skill-scanner`, but its driver version is hard-coded to
`1.0.0`, not the installed 2.0.12. SARIF therefore cannot be trusted for
producer-version provenance in this release.

SARIF omits logical Skill names, Skill roots, analyzer lists, policy identity,
native `is_safe`, maximum native severity, duration, and complete reviewed
scope. A zero-finding SARIF would have empty rules/results and no native
subject evidence.

### Per-run evidence availability

| Evidence concept | Classification | Native evidence |
| --- | --- | --- |
| producer name | ambiguous | SARIF says `skill-scanner`; JSON omits it; experiment names producer Cisco Skill Scanner |
| producer version | missing | JSON missing; SARIF's `1.0.0` value is invalid; external install receipt proves 2.0.12 |
| raw JSON schema version | missing | no schema field |
| SARIF schema version | available directly | SARIF 2.1.0 |
| exact command and requested profile | missing | experiment record only |
| actual enabled analyzers | available directly | JSON `analyzers_used` |
| policy preset and identity | available directly | JSON `scan_metadata` |
| policy fingerprint | available directly | JSON scan-level; per-finding only under verbose |
| start timestamp | derivable without rescanning | completion timestamp minus duration, with ordinary clock limitations |
| completion timestamp | available directly | JSON timestamp; SARIF end time has lower precision |
| exit status | missing | process observation only |
| report availability | derivable without rescanning | file presence |
| logical subject | available directly | single/per-result JSON name and absolute path |
| discovered Skill count | available directly | aggregate total scanned; no separate candidate count |
| complete scanned-file inventory | missing | loader has it internally; report omits it |
| exclusions | missing | only non-empty aggregate `skills_skipped` has limited failure reasons |
| finding count and rule IDs | available directly | JSON and SARIF |
| native severity/category | available directly | JSON and SARIF properties |
| confidence | missing | no field in observed static findings |
| file and line | available directly | line may be null; some static file paths are inconsistent absolute-like repository paths |
| evidence/snippet | available directly | fields exist but were null for observed Cisco findings |
| remediation | available directly | JSON and SARIF |
| native verdict and maximum severity | available directly | JSON `is_safe` and `max_severity` |
| scan duration | available directly | JSON |
| finding ID | available directly | JSON |
| finding fingerprint | producer-specific extension | SARIF copies finding ID into `primaryLocationLineHash` |
| suppression/allowlist evidence | missing | final policy fingerprint exists; no suppressed count or applied suppression ledger |
| analyzer failure | ambiguous | optional `analyzers_failed` exists but installed orchestration records only deferred LLM failures; core exceptions fail the scan |
| completeness/coverage | missing | computed analyzability is not serialized; no analyzer work ledger |
| skipped/disabled/unavailable/not-applicable work | missing | optional analyzers omitted from `analyzers_used`; no reason/state ledger |
| SARIF invocation status | available directly | always true in a successfully generated observed report |

Do not infer completeness from exit `0`, `is_safe: true`, INFO-only maximum
severity, or zero high/critical findings.

## Repeatability and finding identity

The two unchanged combined runs had different raw JSON and SARIF digests.
Timestamp and duration were the only observed differences. A direct
field-by-field comparison excluding those volatile observations found the
remaining JSON and SARIF content equal. This is an experiment observation, not
a proposed normalization or digest algorithm.

| Concept | Observation |
| --- | --- |
| finding order | identical across both primary and verbose pairs |
| Skill order | identical: clean, link, intentional, linked target |
| rule/severity/location/evidence/remediation | identical |
| native verdict | four of four `is_safe: true` in both |
| analyzers | identical core set |
| policy identity | identical within each pair |
| duration | run 1: 203/4/1/1 ms; run 2: 209/4/1/1 ms |
| timestamps | different, as expected |
| scanned-file inventory | missing, so cross-run inventory identity cannot be compared natively |
| exit | `0` for both |

Every missing-license finding used the same native ID
`MANIFEST_MISSING_LICENSE_c5ae9be793`, even across four different Skill
subjects. Source inspection confirms that rule hashes the constant context
`manifest`, not subject or content. This ID is stable across runs but is not a
globally usable semantic finding identity without subject binding.

Within one report, JSON finding ID equals SARIF
`primaryLocationLineHash`, providing cross-format correlation for the observed
findings. That is not a content fingerprint. `--verbose` adds the policy
fingerprint to each finding but does not improve finding subject/content
identity. It also changes the policy fingerprint because verbose changes
output-policy settings.

The concepts remain separate:

- native finding ID: stable here, but collides across subjects;
- policy fingerprint: stable within one exact output policy;
- semantic finding identity: requires at least subject plus native rule/cause;
- cross-run identity: observed for stable fields, not raw bytes;
- cross-format identity: available through JSON ID/SARIF fingerprint;
- raw report digest: useful for exact artifact integrity, intentionally
  different across runs.

## Report SHA-256 inventory

The command was:

```bash
find experiments/cisco-skill-scanner/generated -type f \( -name 'report.json' -o -name 'report.sarif' \) -print0 | sort -z | xargs -0 shasum -a 256
```

| Profile/target | JSON SHA-256 | SARIF SHA-256 |
| --- | --- | --- |
| `local-core-plus-behavioral/allowed-no-declaration` | `455d1cc8973b9e77d7075318c6f16431397b8dde92cccf655c26638743217de5` | `82cea0ee7bebdd7d5948e3dfc7486cf5624106c04b5e3600785568f959b53e0f` |
| `local-core-plus-behavioral/allowed-producer-comma-contrast` | `75860ac84e9dc2b47122e2e39fa77fafed6b5969161f9e345620fba1ce5d9863` | `1924474b851f0c52359f34f998af523f5582c83d8373c42473b466a95f43ddd8` |
| `local-core-plus-behavioral/allowed-standard-multi-tool` | `bf6bc988c6a0d975be250a1d913f12e27c87301963162d31ec2579a38722e4ec` | `ad11f4ae115cd01e6a2b43a08925d94af91a1fb18538698476872f53fbda8362` |
| `local-core-verbose/controlled-combined-run-1` | `d03d87d3a553e90025fa844a4fc357f602d085b6a19d9ee9042de81fd830b467` | `a63c34b22b25a45449b137751d583a376f6c03990a752ecf2b7ff410afcf88d6` |
| `local-core-verbose/controlled-combined-run-2` | `a7909c56d4f9274dcd211a6bfa83d0916f50db4bb4e929c9c4669d31900ae5cc` | `348da84d8491e6b200c3d6f6a063ee9778f2d1f290358611b9df1b95f26d599a` |
| `local-core/allowed-docs-only-standard` | `4dfd0421c7e35dfb755e2fd2185bbcd8b18ed3798e09f4fdf3fd29bf49b91bdc` | `3e48922c85c924cbaa5282ec9c55151c96cfa69385250a9865e5d675a689fd37` |
| `local-core/allowed-no-declaration` | `7bbc5311c71dc72ea247e658829e6bf9ee786df2b100211c2adfbeab4dddcd74` | `5668af7c74989d7bde2a42894500ca2b870185e83f895a42dfa4bc7cc3e10737` |
| `local-core/allowed-producer-comma-contrast` | `070c8d7cbbb7180561a889b9313e19e0778f0f231fb63eaaad517bd1952f6ba3` | `933a51784946023ac8dd7d15665ced375a442bf151b83b9d6c12205f33b0f9e7` |
| `local-core/allowed-single-read` | `f91d0037ba0bcebb0a0acd92ac37a7ff17c87e19bd6fbd2d5971a1b24a4ebe13` | `cba9e44b514647577c3ad52e791c3eb2665bcc78bbfc4f29c43e3ffc4ddac62d` |
| `local-core/allowed-single-webfetch` | `7d1254a717b8740601fe0543e054ea57b4d43920d794b1d47ea5e242907490b6` | `c0bdebab827bff0f3a2de68ec6c53eb90d7f06f8f2bac5d97f7637cdb5f0d6c6` |
| `local-core/allowed-standard-multi-tool` | `86dbef6f018900fa2c0d510cf3fb139cb0ea279537d4ae29a405c4f52eb963f6` | `80a7c30b830dbb5b3f80007d51b10f6e672ac90bae43f3570f75acf5b162dda0` |
| `local-core/allowed-standard-qualified-tools` | `f1a9aa68d510b8e3656d76b2668129bcde4f6d4871d976fc52e4889214ac15f5` | `4dec328592375c75ace284731ecebdd7e15010bd7ba162955d8552981ee45207` |
| `local-core/appium-all` | `eb4fd3d4ae22eb0dea04ed06f3999f2ead4ab5330fa678c2878d14ced54ceec8` | `f2d391d9bf9f13e99ac7ad3763e1f5ba41f3e395084a081206f1db9f505fb102` |
| `local-core/appium-appium-troubleshooting` | `a986518d78a337d455e5d067dfd60a5fe4a4cc3ab04b9c19a8bb8d5145cb345a` | `45d655cb4e480e9ff64baa378e6b25c33fb426f547ba1535036f9da374dcef1b` |
| `local-core/appium-prepare-development-environment` | `be44b2e9afac4a75620e6c3fd1d8053927993ddb5cda349eeb8b01149468ab2f` | `749530f2fa39c7b962e9bc7de8b831a7c6900d27c5e98d1c43a51914f89ed695` |
| `local-core/appium-setup-chromium` | `a4a3303b7043b347a3273d0c9b6ff259b7fe68870527b2c81541311e919271e0` | `5738ac6f2f30ef77b675f701544f9f7b5335661992253a70c5deb72301e4bf4d` |
| `local-core/appium-setup-espresso` | `6c8b724b12fb3ff220e6a824e756d762ada1807f35901eb5b518de4c9ac0756a` | `7bf8f9d3ac35bb714ee33142f3bc83e3c3b1867dbe11fb44bbbce271c975e62a` |
| `local-core/appium-setup-gecko` | `53cbfd4188615a03bf131e879d927e4b26c03980f3cd4c2d7d7f32bdb189fcdd` | `5fafafb10dc1034f2aa8e9b7b6f2780e2d9b108bbc6d3537a7105cdc018373c4` |
| `local-core/appium-setup-mac2` | `b3d87f48f25e2b54c438d2866844c95ad433dc7040c1af7b9692a56838b43baa` | `c7857f2ff8a4a8ff50563ded990ccc87260a7d4144bfda262694b30b42b5118a` |
| `local-core/appium-setup-safari` | `74c635264a4a6f9aee80c7cd395775ffc9618142108e2521b59b2977a32de247` | `e44f355ca2025f2f92957fd69c86807353713424363630f845df1061a4c10f45` |
| `local-core/appium-setup-uiautomator2` | `c7acb41f01061bae9be797dcd89a54dc687ec9528281079119ca706f94a0a333` | `c06ae7ec3ba2377ad0cab413ce70060395f328f2dff08d336a88b0379887d9b3` |
| `local-core/appium-setup-xcuitest` | `17574e4dc667eca7b5c16c5754498037c1e4041ef7b92be3989812a9158cc766` | `204d391fb86df8af6040c38b04280e9c69acfd196822be7ff4b9abbaed318544` |
| `local-core/appium-setup` | `3b6783fcf6735bcba25bcafd20fb79df6dade37ff630b84e6fff8ec2c31137e0` | `e053fda60bce7c53fd10e14d2344df6d4277c1072c8b4fd910b7da2a305233be` |
| `local-core/appium-xcuitest-real-device-config` | `7981b11dfca3d8abd7c9cceddb815650ca1f687f8d43b50e019180de90952709` | `9725ef7594730b7da33a3dea5ab1ee163fe2f5ff75a613fcc72626cd4f60d32b` |
| `local-core/controlled-clean-control` | `c929af5f030888e58bca55dfcb4518f40b68c93f964590ca2d9c1b873d713d25` | `07e923978d0e2b921cbe55b7aca0845e7d0ccc41a3dbb9100301607be2a3e3d2` |
| `local-core/controlled-combined-run-1` | `f93f3c859304c2d207ee851708f8a65f5cd645de4c77ff46f03544b9340b8158` | `439e345084014ce0ad6813146c0beebcc97990a4d7b9874b36b4e4aec9988124` |
| `local-core/controlled-combined-run-2` | `4b1db454ff763c9c4b23088232473ea2b85b7c02f33bfe55f390bef060402123` | `a05ddbf60e1c0fbd4e8b20a657ca5d93700d8e823ec8119805c6683bcbfa7c85` |
| `local-core/controlled-intentional-positive` | `0a3a226f381bd74af232438311598f18bec6a0f0d3220eff407024e5fc50f1bd` | `e4afc0a7bca6670ab8020aabdeef9f5f2a79c66b61a04fe3a78dd81e2988b3c6` |
| `local-core/controlled-link-false-positive` | `cb87c83584766e2ae1e863c91c67c3c36bcdfaccb856d61caf8e3230046169d0` | `5c161e0b02de26c4278aba0b5e1f563c2a5ef1f7fdffd1eefefae704eebb830b` |
| `local-core/renma-release-prep` | `71ce26a288e7601be19375e7ba82ea4e61668393fbbfcb320bdff1b99c16dbba` | `7a3084411f208e1c13f8294ac4140907d2a2413ec9e6155bfa474526a1296009` |
| `local-core/renma-spec-review` | `ab4b122519b000d98a1a7dedf8b01ebc1b08a6dcf4bd737f65e202b19e478ff6` | `770e49e455f9519fc6a4c4b86c56aa190d373a4716b74c18bcbfc60ed33c142f` |

Reports are intentionally uncommitted.

### Binding classifications for every selected Cisco scan

The rows below cover every report pair in the SHA-256 inventory. Repeated and
profile-variant runs are named explicitly so no scan inherits an unstated
classification.

| Selected scan or scan group | Logical-subject binding | Reviewed-scope binding | Reason |
| --- | --- | --- | --- |
| `controlled-intentional-positive`, `controlled-link-false-positive`, `controlled-clean-control` | exact | partial | native name/path identify each root; no complete file inventory or hashes |
| `allowed-no-declaration`, `allowed-single-read`, `allowed-single-webfetch`, `allowed-standard-multi-tool`, `allowed-standard-qualified-tools`, `allowed-producer-comma-contrast`, `allowed-docs-only-standard` | exact | partial | native name/path identify each root; no complete file inventory or hashes |
| the three corresponding `local-core-plus-behavioral` scans | exact | partial | same subject evidence and scope gap under the separately classified profile |
| `controlled-combined-run-1` and `controlled-combined-run-2` | partial | partial | four per-result names/paths are exact, but the aggregate invocation root and full inventories are absent |
| both `local-core-verbose` combined runs | partial | partial | same aggregate subject and scope limitations |
| `renma-release-prep`, `renma-spec-review` | exact | partial | native names/paths match Renma catalog; no complete file inventory or hashes |
| all 11 `appium-<skill-name>` individual scans | exact | partial | native names/paths match Renma catalog; selected support-file inventories and hashes are absent |
| `appium-all` | partial | partial | all 11 result subjects are exact, but the aggregate invocation root and complete per-Skill inventories are absent |

## Completeness and profile analysis

| Layer | Cisco 2.0.12 evidence |
| --- | --- |
| producer execution | SARIF says `executionSuccessful: true` when a report is generated; process status is external |
| enabled analyzer set | JSON directly lists analyzers that returned from the orchestration path |
| producer-native completeness | missing; no planned/completed/skipped/failed/not-applicable ledger |
| required-profile completeness | can only be partially checked by comparing requested core names with `analyzers_used`; internal work completion is unknown |
| native assessment | JSON directly exposes `is_safe` and maximum severity |

The source computes analyzability, but `ScanResult.to_dict()` does not serialize
the score or file details. `analyzers_failed` is optional and, in installed
orchestration, is populated for deferred LLM analyzer errors rather than a
general analyzer ledger. A core analyzer exception prevents normal report
generation. Optional analyzers that were not selected simply disappear.

SkillSpector exposes a component inventory, scope exclusions, coverage counts,
and per-analyzer states including disabled and not-applicable. Cisco does not
expose comparable completeness. This is a producer-contract difference, not a
reason to reinterpret Cisco's `is_safe`.

## Subject and reviewed-scope binding

| Evidence | Cisco | SkillSpector | Provider-neutral implication |
| --- | --- | --- | --- |
| canonical Skill name | direct in JSON | direct for canonical scans; broad roots may be `unknown` | shared concept |
| Skill root | absolute in JSON | absolute source | shared concept with path-portability concerns |
| repository-relative paths | finding locations only; sometimes inconsistent | complete relative component list in JSON | available reliably from only SkillSpector |
| complete file inventory | missing | available | available from only SkillSpector |
| component hashes | missing | missing | missing from both producers |
| repository revision | missing | missing | requires repository evidence |
| dirty state | missing | missing | requires repository evidence |

The Renma BOM and catalog are useful independent evidence, but they do not make
a Cisco report exact when Cisco omits the component set and content hashes.
Binding by invocation path is not content binding.

## Cross-producer finding comparison

| Observation | Classification | Evidence |
| --- | --- | --- |
| intentional controlled snooping sentence | producer-specific concern | SkillSpector emitted AS3; Cisco emitted only missing license |
| benign same-repository Markdown link | likely false-positive candidate | SkillSpector emitted two AS3 results for one cause; Cisco emitted neither; disagreement is not proof |
| duplicate behavior | producer-specific concern | SkillSpector duplicated the link cause; Cisco did not, but Cisco reused one license finding ID across four subjects |
| Appium same-repository routing references | likely false-positive candidate | SkillSpector emitted AS3 on routing/handoff text; Cisco did not |
| local `npx appium` documentation | producer-specific concern | SkillSpector RP1 treated unversioned `npx` text as rug-pull risk; Cisco reported no equivalent |
| Appium executable scripts | different scope caused the difference | SkillSpector repository-root probe selected 124 files including repository scripts; Cisco `scan-all` selected only 11 Skill roots and their support files |
| controlled `allowed-tools` | producer-specific concern | both inspect declared permissions/capabilities, but tokenization, absence behavior, network semantics, and rule models differ |
| clean control | producer-specific concern | SkillSpector had zero findings; Cisco emitted missing license INFO while still marking safe |
| Appium individual Skills | different analyzer profile caused the difference | SkillSpector reported AS3/RP1 on several Skills; Cisco's different local-core analyzer profile and coverage reported only missing license INFO on all 11 |

The Appium SkillSpector root report contained 86 issues across 124 components:
62 AS3, 21 RP1, two EA3, and one P1. Its 11 individual reports contained AS3
and/or RP1 except five one-RP1 cases. Cisco's aggregate and individual scans
contained exactly one missing-license INFO per Skill. Agreement is not proof
and disagreement is not a defect by itself.

## Suppression and policy evidence

Cisco's CLI supports named or custom scan policies. Installed policy source
supports rule-level `disabled_rules`, severity overrides, allowlists, rule
scoping, and heuristic false-positive suppression. `--verbose` exposes the
active policy fingerprint per finding; scan-level JSON exposes policy
name/version/preset/fingerprint even without verbose.

The CLI has no documented per-finding baseline, ignored-finding file, or
fingerprint-selective suppression command comparable to SkillSpector's
baseline. Reports do not expose suppressed counts, which rule-level
suppressions matched, or why a potential finding was removed. No Cisco
suppression experiment was run because a per-finding CLI capability was not
documented. The policy fingerprint is useful identity, but it is not a
suppression ledger.

## Two-producer provider-neutral concept comparison

| Candidate concept | Classification | Evidence across Cisco and SkillSpector |
| --- | --- | --- |
| producer provenance | shared provider-neutral concept | both need name/version, but Cisco native version is missing/incorrect and must come from installation evidence |
| adapter provenance | missing from both producers | no adapter exists |
| report format and schema version | shared concept with incompatible producer semantics | both emit JSON/SARIF; native JSON is unversioned; SARIF is 2.1.0; Cisco tool version is wrong |
| assessment profile identity | shared provider-neutral concept | both require an experiment-defined profile; only Cisco exposes a policy identity directly |
| analyzer-set identity | shared concept with incompatible producer semantics | Cisco lists used analyzer names; SkillSpector provides a richer analyzer ledger |
| logical subject | shared provider-neutral concept | both expose name/source, with broad-root limitations |
| reviewed scope | shared provider-neutral concept | both need it; SkillSpector inventory is stronger and Cisco inventory is missing |
| per-component identity | shared concept with incompatible producer semantics | SkillSpector has relative component paths; Cisco only partial finding paths |
| per-component content evidence | missing from both producers | neither native report hashes every reviewed component |
| repository revision | missing from both producers | external repository evidence only |
| dirty-state qualification | missing from both producers | external repository evidence only |
| producer execution | shared concept with incompatible producer semantics | Cisco SARIF invocation plus process status; SkillSpector explicit execution field and ledger |
| producer-native completeness | available from only one producer | SkillSpector exposes it; Cisco does not |
| required-profile completeness | shared provider-neutral concept | neither provides the final governance answer directly; Cisco evidence is substantially weaker |
| limitations | shared concept with incompatible producer semantics | SkillSpector serializes limitations/statuses; Cisco relies on docs/source and absent fields |
| findings | shared provider-neutral concept | both expose native findings without rule translation |
| finding identity | shared concept with incompatible producer semantics | SkillSpector UUID-like run IDs plus fingerprints; Cisco deterministic IDs collide across subjects |
| raw report digest | shared provider-neutral concept | exact artifact integrity is useful for both; repeat runs may differ |
| native assessment | shared concept with incompatible producer semantics | SkillSpector score/severity/recommendation differs from Cisco high/critical `is_safe` |
| suppression or policy identity | shared concept with incompatible producer semantics | SkillSpector baseline fingerprint mechanics; Cisco policy fingerprint without applied-suppression ledger |
| timestamp and freshness | shared provider-neutral concept | both timestamp reports; freshness still requires content/profile/version binding |

Two producers justify discussing these concepts. They do not justify public
field names, JSON Schema, a normalized digest algorithm, a parser contract, or
a generic framework.

## Second-producer decision gates

| Gate | Decision | Evidence |
| --- | --- | --- |
| output can be parsed reliably | partially met | observed JSON/SARIF parsed consistently, but JSON is unversioned and SARIF tool version is wrong |
| producer version is available | partially met | exact external receipt and CLI probe; native JSON missing and SARIF invalid |
| actual analyzer profile is available | partially met | JSON lists analyzers used and policy identity, but not planned/disabled/applicability states |
| execution status is available | partially met | process status plus SARIF success; JSON lacks execution state and failed core work may yield no report |
| completeness and limitations are visible | not met | no serialized completeness or limitations ledger |
| logical subject can be bound | met | current individual names and paths bind to Renma catalog subjects |
| exact reviewed scope can be bound | not met | no complete inventory or hashes |
| findings have usable stable identity | partially met | cross-run/cross-format stability observed, but same ID collides across subjects and is not content-bound |
| raw report digest is useful | met | useful exact-artifact integrity evidence; not semantic/cross-run identity |
| suppression or policy identity is available | partially met | policy fingerprint available; applied suppression evidence missing |
| native findings can remain separate from Renma diagnostics | met | experiment and formats preserve producer-native rules and assessments |
| common provider-neutral concepts exist across two producers | met | provenance, profile, subject, scope, execution, findings, assessment, digest, and freshness recur |
| a minimal non-production receipt concept is justified | partially met | conceptual projection can preserve known/unknown states; exact scope and completeness remain gaps |
| a parser spike is justified | not met | Cisco's unversioned JSON and incorrect SARIF producer version need upstream contract clarity first |
| a generic adapter framework is justified | not met | two incompatible producers and material contract gaps are insufficient |

## Final recommendation

**Perform a non-production two-producer receipt-design spike.**

The evidence now supports a genuinely provider-neutral discussion: the same
governance questions recur even though native rule models, permission
semantics, assessment logic, completeness, scope, policy, and identity differ.
The spike should stay conceptual, show how unknown scope/completeness and
externally supplied provenance are represented without pretending they are
native, and preserve all native findings separately.

Do not implement a parser, adapter, schema, SDK, registry, Renma field, or
runtime behavior as part of that recommendation.
