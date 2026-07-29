# SkillSpector Evaluation Protocol

Use this protocol to record observed behavior from the opt-in experiment. Do
not fill a result from expected behavior, documentation, or an unexecuted
command. Native reports remain authoritative for SkillSpector findings and
verdicts.

## Evaluation Questions

1. Did the scan execute successfully?
2. Was the inspection complete, partial, or unknown?
3. Which scan mode actually ran?
4. Which rule IDs and severities were emitted?
5. Which findings appear actionable?
6. Which findings appear to be false positives or governance-quality findings
   rather than security findings?
7. Which findings overlap with current Renma bounded safety lint?
8. Which findings clearly belong only to SkillSpector or another specialized
   scanner?
9. Was a suppression or baseline needed to make the result operationally
   usable?
10. Does the report expose enough stable data for a future adapter?
11. Can the report be reliably bound to the exact Skill path and content?
12. Does the report distinguish disabled, skipped, failed, and completed
    analysis?
13. How does static-only output differ from optional LLM output?
14. Does SkillSpector correctly understand the current Agent Skills
    representation, including `allowed-tools`?
15. Which values belong in the provider-neutral receipt, and which must remain
    SkillSpector-specific extensions?

## Per-Run Record

Copy this template for every actual run:

```text
Date:
Renma commit:
SkillSpector version or commit:
Target ID:
Target path:
Command:
Requested scan mode:
Actual scan mode:
JSON report SHA-256:
SARIF report SHA-256:
Completion status:
Finding counts by rule and severity:
Actionable findings:
False-positive candidates:
Renma overlap:
Specialized-scanner-only findings:
Suppression or baseline used:
Adapter-data observations:
Limitations:
Human notes:
```

Hash raw reports after generation, for example:

```bash
shasum -a 256 experiments/skillspector/generated/static-only/root-release-prep/report.json
shasum -a 256 experiments/skillspector/generated/static-only/root-release-prep/report.sarif
```

## Initial Execution Status

Executed for both canonical Skill targets on 2026-07-28 UTC. SkillSpector was
installed externally with `uv tool install`; no Renma dependency or package
file changed. Repository-level probes and the optional LLM path were not
executed.

Common observations:

- SkillSpector version: `2.5.0`, installed from upstream commit
  `34f60308522f45447cd343da0aad77bcea308ad4`.
- Renma commit: `4a4bde17447dd6a7a8eae972376b375599316bc1`.
- Runner command:
  `node experiments/skillspector/run.mjs --kind canonical-skill`, with
  `RENMA_SKILLSPECTOR_EXECUTABLE` set to the isolated installed executable.
- Requested and observed configuration: static-only; `llm_requested` and
  `llm_available` were both `false`, and the three semantic analyzers were
  reported as `disabled`.
- Both producer executions succeeded and reported all discovered components as
  scanned with `coverage_percent: 100.0`. Both also reported
  `is_complete: false` because the requested static-only mode intentionally
  disabled the semantic analyzers.
- These were not complete all-analyzer reviews. Whether the same evidence could
  satisfy a future explicitly static-only requirement remains unresolved until
  profile-relative completeness is defined.
- Both reports contained zero issues before and after filtering, zero
  suppressions, and producer-specific assessment values of score `0`, severity
  `LOW`, and recommendation `SAFE`. These observations are not proof of safety
  and are not Renma findings or Readiness evidence.
- No baseline or suppression was used or needed for these runs.
- The two different zero-finding targets produced the same SARIF digest:
  `ac048bad24d7a13a9578dd60e770347cc4750647e521991754dd117fe59ef8d4`.
  An empty native SARIF report therefore does not independently establish
  subject or reviewed-scope identity.

### `example-spec-review`

```text
Date: 2026-07-28 UTC
Renma commit: 4a4bde17447dd6a7a8eae972376b375599316bc1
SkillSpector version or commit: 2.5.0 / 34f60308522f45447cd343da0aad77bcea308ad4
Target ID: example-spec-review
Target path: examples/context-repo/skills/testing/spec-review
Command: node experiments/skillspector/run.mjs --kind canonical-skill
Requested scan mode: static-only
Actual scan mode: static analyzers enabled; semantic analyzers disabled
JSON report SHA-256: 63dee2696270954ebc81933940f896a04ced6903c7785e3bfaa01181cb0dcd6b
SARIF report SHA-256: ac048bad24d7a13a9578dd60e770347cc4750647e521991754dd117fe59ef8d4
Completion status: producer execution successful; 1/1 components scanned; producer is_complete false
Finding counts by rule and severity: none
Actionable findings: none observed
False-positive candidates: none observed
Renma overlap: none observed
Specialized-scanner-only findings: none observed
Suppression or baseline used: no
Limitations: semantic analyzers disabled; AST, taint, MCP least privilege, and meta analysis not applicable
Human notes: allowed-tools behavior was not evaluated because this Skill does not declare allowed-tools
```

### `root-release-prep`

```text
Date: 2026-07-28 UTC
Renma commit: 4a4bde17447dd6a7a8eae972376b375599316bc1
SkillSpector version or commit: 2.5.0 / 34f60308522f45447cd343da0aad77bcea308ad4
Target ID: root-release-prep
Target path: skills/release-prep
Command: node experiments/skillspector/run.mjs --kind canonical-skill
Requested scan mode: static-only
Actual scan mode: static analyzers enabled; semantic analyzers disabled
JSON report SHA-256: 5773753bc66498baff59b0245b6c07a933c038b568cfd5e90ae6ae6848c04534
SARIF report SHA-256: ac048bad24d7a13a9578dd60e770347cc4750647e521991754dd117fe59ef8d4
Completion status: producer execution successful; 1/1 components scanned; producer is_complete false
Finding counts by rule and severity: none
Actionable findings: none observed
False-positive candidates: none observed
Renma overlap: none observed
Specialized-scanner-only findings: none observed
Suppression or baseline used: no
Limitations: semantic analyzers disabled; AST, taint, MCP least privilege, and meta analysis not applicable
Human notes: allowed-tools behavior was not evaluated because this Skill does not declare allowed-tools
```

### Adapter Contract Observations

The raw JSON exposes producer version, absolute source path, reviewed component
paths, execution success, coverage, analyzer-level
completed/disabled/not-applicable states, limitations, assessment, and
suppressed count. It does not expose per-component content hashes. SARIF
exposes producer version, execution success, limitations as notifications, and
native results.

The raw JSON does not expose an explicit report-schema version, Renma asset ID,
subject content hash, repository revision, assessment-profile digest, or raw
report digest. This evaluation recorded repository revision and report digests
separately. Public Renma BOM evidence can contribute stable paths and hashes
only for reviewed components represented in `assets[]`; exact binding for other
reviewed files would need additional file-level evidence. The identical empty
SARIF reports reinforce that a future adapter must add binding from stable
repository evidence rather than infer identity from the native report digest.
This supports keeping binding in a future adapter and keeping the native report
separate.

The report distinguishes disabled, not-applicable, and completed analyzers, and
has counters for skipped, failed, and unaccounted work. The observed
`coverage_percent: 100.0` plus `is_complete: false` is important contract
evidence: producer-native completeness, required-profile completeness,
execution, and assessment must remain separate dimensions. Reliability across
producer versions, behavior with findings and suppressions, `allowed-tools`
interpretation, repository-probe behavior, future static-only requirement
satisfaction, and comparison with optional LLM output remain unresolved.

## Repository-Probe Execution Status

Executed all three configured repository probes on 2026-07-29 UTC. The two
historical canonical Skill records above were not rerun or changed.
SkillSpector remained externally installed with `uv tool`; its installation
receipt identifies upstream commit
`34f60308522f45447cd343da0aad77bcea308ad4`. No Renma dependency or package
file changed.

Common execution observations:

- Renma commit:
  `6219902ef313e5093d3db744ad9d8dbffaa88c43`.
- SkillSpector version: `2.5.0`.
- Runner command:
  `RENMA_SKILLSPECTOR_EXECUTABLE=/Users/kazu/.local/bin/skillspector node experiments/skillspector/run.mjs --kind repository-probe`.
- Requested and observed mode: static-only. The native JSON reported
  `llm_requested: false` and `llm_available: false`; the harness invocation
  included `--no-llm`.
- Both native-format commands completed for every target with exit `0`.
  Harness execution completed, producer execution completed, the native
  threshold passed, and both reports were written. These are separate facts
  from completeness and scope binding.
- Every target reported `coverage_percent: 100.0` and also
  `is_complete: false`. Required-profile completeness remains unknown because
  no assessment-profile ID, digest, or required-analyzer set was present.
- No suppression or baseline was used. Every report had
  `suppressed_count: 0`, but no suppression behavior was exercised.
- The optional LLM mode was not run because its provider, credential,
  approved-content, and reviewed data-egress prerequisites were not
  established for this evaluation.

### `example-context-lens`

```text
Date: 2026-07-29 UTC
Renma commit: 6219902ef313e5093d3db744ad9d8dbffaa88c43
SkillSpector version or commit: 2.5.0 / 34f60308522f45447cd343da0aad77bcea308ad4
Target ID: example-context-lens
Target path: examples/context-lens
Command: RENMA_SKILLSPECTOR_EXECUTABLE=/Users/kazu/.local/bin/skillspector node experiments/skillspector/run.mjs --kind repository-probe
Requested scan mode: static-only
Actual scan mode: --no-llm; llm_requested false; llm_available false; semantic analyzers disabled
JSON report SHA-256: 24a7d571ef2a55ce759a06abc271af5ed34885f0e60ca08cd2df420d6c1978c1
SARIF report SHA-256: ac048bad24d7a13a9578dd60e770347cc4750647e521991754dd117fe59ef8d4
Harness execution: completed for JSON and SARIF
Producer execution: completed for JSON and SARIF; execution_successful true
Native assessment: threshold-passed; score 0; severity LOW; recommendation SAFE
Report availability: JSON and SARIF written
Producer-native completeness: is_complete false
Required-profile completeness: unknown; no profile identity or required-analyzer set
Logical-subject binding: partial; native name unknown and source is an absolute repository-root path
Reviewed-scope binding: partial; target-relative component paths are present but component hashes and repository revision are absent
Discovered/scanned components: 5/5
Coverage: 100.0%; 5 fully inspected, 0 partially inspected, 0 entirely uninspected
Completed analyzers: mcp_rug_pull, static_patterns_agent_snooping, static_patterns_anti_refusal, static_patterns_data_exfiltration, static_patterns_excessive_agency, static_patterns_harmful_content, static_patterns_memory_poisoning, static_patterns_output_handling, static_patterns_privilege_escalation, static_patterns_prompt_injection, static_patterns_rogue_agent, static_patterns_ssrf, static_patterns_supply_chain, static_patterns_system_prompt_leakage, static_patterns_tool_misuse, static_yara
Disabled analyzers: semantic_developer_intent, semantic_quality_policy, semantic_security_discovery
Not-applicable analyzers: behavioral_ast, behavioral_taint_tracking, mcp_least_privilege, mcp_tool_poisoning, meta_analyzer
Skipped/failed/unknown analyzer work: none reported; every skipped, failed, and unaccounted counter was 0
Limitations: three semantic analyzers disabled by configuration; AST, taint, and meta analysis had no applicable files; MCP least-privilege and tool-poisoning analysis reported manifest_absent
Finding counts by rule and severity: none; findings_before_filtering 0; findings_after_filtering 0
Actionable findings: none observed
False-positive candidates: none observed
Renma overlap: none observed
Specialized-scanner-only findings: none observed
Suppression or baseline used: no; suppressed_count 0
Adapter-data observations: JSON identifies the absolute source root and five relative components; empty SARIF has no subject or component inventory
Human notes: favorable native assessment is not proof of safety; allowed-tools was not evaluated because the reviewed Skill does not declare it
```

The exact JSON component inventory was:

```text
README.md
contexts/testing/boundary-value-analysis.md
lenses/testing/spec-review-boundary-values.md
lenses/testing/test-design-boundary-values.md
skills/testing/spec-review/SKILL.md
```

The scan included the one canonical Skill file plus repository README, Context,
and Lens support files. The native report did not identify those assets as
separate logical subjects or report how many Skills it recognized.

### `example-context-repo`

```text
Date: 2026-07-29 UTC
Renma commit: 6219902ef313e5093d3db744ad9d8dbffaa88c43
SkillSpector version or commit: 2.5.0 / 34f60308522f45447cd343da0aad77bcea308ad4
Target ID: example-context-repo
Target path: examples/context-repo
Command: RENMA_SKILLSPECTOR_EXECUTABLE=/Users/kazu/.local/bin/skillspector node experiments/skillspector/run.mjs --kind repository-probe
Requested scan mode: static-only
Actual scan mode: --no-llm; llm_requested false; llm_available false; semantic analyzers disabled
JSON report SHA-256: d0954312393917ad3685beeb4c4497e6c2bca2a0453472a50f8144ded50a71c1
SARIF report SHA-256: ac048bad24d7a13a9578dd60e770347cc4750647e521991754dd117fe59ef8d4
Harness execution: completed for JSON and SARIF
Producer execution: completed for JSON and SARIF; execution_successful true
Native assessment: threshold-passed; score 0; severity LOW; recommendation SAFE
Report availability: JSON and SARIF written
Producer-native completeness: is_complete false
Required-profile completeness: unknown; no profile identity or required-analyzer set
Logical-subject binding: partial; native name unknown and source is an absolute repository-root path
Reviewed-scope binding: partial; target-relative component paths are present but component hashes and repository revision are absent
Discovered/scanned components: 8/8
Coverage: 100.0%; 8 fully inspected, 0 partially inspected, 0 entirely uninspected
Completed analyzers: mcp_rug_pull, static_patterns_agent_snooping, static_patterns_anti_refusal, static_patterns_data_exfiltration, static_patterns_excessive_agency, static_patterns_harmful_content, static_patterns_memory_poisoning, static_patterns_output_handling, static_patterns_privilege_escalation, static_patterns_prompt_injection, static_patterns_rogue_agent, static_patterns_ssrf, static_patterns_supply_chain, static_patterns_system_prompt_leakage, static_patterns_tool_misuse, static_yara
Disabled analyzers: semantic_developer_intent, semantic_quality_policy, semantic_security_discovery
Not-applicable analyzers: behavioral_ast, behavioral_taint_tracking, mcp_least_privilege, mcp_tool_poisoning, meta_analyzer
Skipped/failed/unknown analyzer work: none reported; every skipped, failed, and unaccounted counter was 0
Limitations: three semantic analyzers disabled by configuration; AST, taint, and meta analysis had no applicable files; MCP least-privilege and tool-poisoning analysis reported manifest_absent
Finding counts by rule and severity: none; findings_before_filtering 0; findings_after_filtering 0
Actionable findings: none observed
False-positive candidates: none observed
Renma overlap: none observed
Specialized-scanner-only findings: none observed
Suppression or baseline used: no; suppressed_count 0
Adapter-data observations: JSON identifies the absolute source root and eight relative components; empty SARIF has no subject or component inventory
Human notes: favorable native assessment is not proof of safety; allowed-tools was not evaluated because the reviewed Skill does not declare it
```

The exact JSON component inventory was:

```text
README.md
contexts/domain/payment/idempotency.md
contexts/testing/boundary-value-analysis.md
contexts/testing/negative-testing.md
lenses/testing/spec-review-boundary-values.md
renma.config.json
skills/testing/spec-review/SKILL.md
tools/appium/README.md
```

The scan included every visible file under this example root: the one canonical
Skill file and repository README, Contexts, Lens, Renma configuration, and tool
documentation. The native report did not distinguish the Skill from the other
components as a logical subject.

### `example-interactive-placeholder`

```text
Date: 2026-07-29 UTC
Renma commit: 6219902ef313e5093d3db744ad9d8dbffaa88c43
SkillSpector version or commit: 2.5.0 / 34f60308522f45447cd343da0aad77bcea308ad4
Target ID: example-interactive-placeholder
Target path: examples/interactive-placeholder
Command: RENMA_SKILLSPECTOR_EXECUTABLE=/Users/kazu/.local/bin/skillspector node experiments/skillspector/run.mjs --kind repository-probe
Requested scan mode: static-only
Actual scan mode: --no-llm; llm_requested false; llm_available false; semantic and meta analyzers disabled
JSON report SHA-256: ed59d1c9ba7e3e0e50c4af76da0c2603de986657f2accc9a884ae604d1b0d4d1
SARIF report SHA-256: bafdb503a9d95ade09d8cdb63a35a0b75733f3d94ec422675a4eeb66b15ae8bd
Harness execution: completed for JSON and SARIF
Producer execution: completed for JSON and SARIF; execution_successful true
Native assessment: threshold-passed; score 8; severity LOW; recommendation SAFE
Report availability: JSON and SARIF written
Producer-native completeness: is_complete false
Required-profile completeness: unknown; no profile identity or required-analyzer set
Logical-subject binding: partial; native name unknown and source is an absolute repository-root path
Reviewed-scope binding: partial; target-relative included and excluded paths are present but component hashes and repository revision are absent
Discovered/scanned components: 6/6, plus one explicit out-of-scope hidden file
Coverage: 100.0%; 6 fully inspected, 0 partially inspected, 0 entirely uninspected
Completed analyzers: mcp_rug_pull, static_patterns_agent_snooping, static_patterns_anti_refusal, static_patterns_data_exfiltration, static_patterns_excessive_agency, static_patterns_harmful_content, static_patterns_memory_poisoning, static_patterns_output_handling, static_patterns_privilege_escalation, static_patterns_prompt_injection, static_patterns_rogue_agent, static_patterns_ssrf, static_patterns_supply_chain, static_patterns_system_prompt_leakage, static_patterns_tool_misuse, static_yara
Disabled analyzers: meta_analyzer, semantic_developer_intent, semantic_quality_policy, semantic_security_discovery
Not-applicable analyzers: behavioral_ast, behavioral_taint_tracking, mcp_least_privilege, mcp_tool_poisoning
Skipped/failed/unknown analyzer work: none reported; every skipped, failed, and unaccounted counter was 0
Limitations: semantic and meta analyzers disabled by configuration; AST and taint reported no applicable files; MCP least-privilege and tool-poisoning analysis reported manifest_absent; workspace/.gitignore excluded as hidden
Finding counts by rule and severity: AS3/MEDIUM 2; findings_before_filtering 2; findings_after_filtering 2
Actionable findings: none after human review of the cited README context
False-positive candidates: both identical AS3 findings; the README links to this example's single intended Skill as documentation and does not enumerate or read peer installed Skills
Renma overlap: no matching current Renma diagnostic; the cited README link is outside Renma's bounded Skill-body security finding set
Specialized-scanner-only findings: AS3 Agent Snooping / Skill Enumeration remains producer-native and must not be translated to a Renma diagnostic
Suppression or baseline used: no; suppressed_count 0
Adapter-data observations: two semantically identical findings have different native finding IDs, and the separate JSON and SARIF executions produced different IDs again
Human notes: duplicate likely false positives and the favorable native recommendation both require human interpretation; allowed-tools was not evaluated because the reviewed Skill does not declare it
```

The exact JSON component inventory was:

```text
README.md
assets/template.txt
renma.config.json
skills/replace-placeholder/SKILL.md
tools/README.md
tools/placeholder-demo.mjs
```

`workspace/.gitignore` was separately reported as excluded with
`reason_code: hidden_file`. The component list includes
`tools/placeholder-demo.mjs`, but the native metadata reported
`has_executable_scripts: false`, classified that component as `type: other`
with `executable: false`, and marked both behavioral AST and taint tracking
`not_applicable`. Therefore `coverage_percent: 100.0` describes coverage of the
producer's selected applicable work, not proof that executable-code analysis
ran.

Both JSON findings and both SARIF results cite `README.md` line 25, native rule
`AS3`, the same snippet, and the same explanation. Their generated finding IDs
do not match across the separately executed formats. A parser can preserve
these producer IDs, but this run provides no evidence that they are stable
identities or suitable deduplication keys.

The cited README line is a normal Markdown documentation link to this example's
own `skills/replace-placeholder/SKILL.md`. SkillSpector 2.5.0's installed AS3
static patterns include a case-insensitive path matcher for
`skills/<name>/SKILL.md`. Markdown repeats that path once as the link text and
once as the link destination, and the producer emitted one result for each
match. Because both results cite the same line, rule, snippet, and explanation,
this is evidence for classifying them as likely duplicate false-positive
candidates in this corpus. It is not evidence that all AS3 findings are false
positives.

## Repository-Probe Scope Analysis

The repository probes expose materially different scope behavior from a
canonical Skill scan:

- Each probe corpus currently contains one `SKILL.md`, but SkillSpector did not
  report a recognized Skill count or a per-Skill boundary. Every repository
  report used `skill.name: "unknown"`.
- JSON included all visible files under the lens and context-repository roots.
  It also included all visible files under the interactive root and explicitly
  excluded its hidden `.gitignore`. Support files and files outside the
  canonical Skill directory were therefore part of the reviewed component
  set.
- `skill.source` is absolute. JSON component paths are relative to that scan
  root, not to the Renma repository root. All three observed component lists
  were lexicographically ordered and contained no duplicates. A single run per
  target does not establish that ordering as a stable producer contract.
- JSON exposes component path, type, line count, byte count, and executable
  flag, but no component content hash. It exposes no stable logical-subject ID,
  repository revision, or review-scope digest.
- SARIF does not preserve the JSON component inventory. The interactive SARIF
  contains relative paths only where findings or the scope-exclusion
  notification need locations. Empty SARIF contains no source-root or component
  identity at all.
- The empty lens and context-repository SARIF reports have the same digest,
  which also equals the historical empty SARIF digest for both canonical Skill
  targets. Empty SARIF is therefore not distinguishable across these four
  logical targets. The corresponding JSON reports are distinguishable by
  source, component list, and timestamp.

The experiment conclusion for reviewed-scope binding is **partial** for all
three probes. The harness knows the configured repository-relative target and
Renma commit, while native JSON supplies the scan-root-relative component paths
and an explicit exclusion in one case. BOM v2 can supply stable
repository-relative identity and content hashes for reviewed components that
are represented as Renma assets, but it does not promise a hash inventory for
every file an external reviewer may select. In particular, the context-repo and
interactive probe inventories both include `renma.config.json`; their
configured globs do not include that file, and BOM v2's optional `configPath`
does not carry its content hash.

Exact full reviewed-scope binding therefore needs additional file-level
evidence for components outside hashed BOM assets. Candidate sources include
producer-supplied component hashes, a separate deterministic repository file
manifest, or a future additive Renma evidence contract. This experiment does
not choose or implement any of those sources. The native report alone cannot
establish exact content identity, and SARIF alone cannot establish the complete
reviewed component set.

Logical-subject binding is also partial. The harness target is a stable
experiment ID and repository-relative path, but SkillSpector reports the native
subject name as `unknown` and does not distinguish the repository root, its
canonical Skill, Contexts, Lenses, configuration, and support files as separate
logical subjects.

## Canonical Skill And Repository-Probe Comparison

| Dimension | Historical canonical Skill runs | Repository-probe runs |
| --- | --- | --- |
| Discovered components | One `SKILL.md` component for each target | Five, eight, and six visible components across the roots, plus one explicit hidden-file exclusion |
| Subject identity | Native Skill name plus absolute source path | Native name `unknown` plus absolute repository-root path |
| Reviewed scope | One target-relative component path | Multiple target-relative component paths spanning Skills and support/repository files |
| Completeness | `100.0%` component coverage and `is_complete: false` | Same separation; the interactive probe additionally disabled meta analysis while included JavaScript received no AST or taint work |
| Report structure | JSON carries scope; empty SARIF carries no subject/scope | Same format asymmetry; SARIF only adds locations when findings or exclusions exist |
| Empty-report identity | The two empty SARIF reports were identical | The two empty repository SARIF reports were identical to each other and to both historical canonical reports |
| Native findings | Zero | Zero for two probes; two duplicate `AS3`/`MEDIUM` results for the interactive README |
| Adapter binding feasibility | Native Skill name helps identify a candidate subject, but hashes and revision are absent | Harness target plus JSON paths can be joined to BOM identity and hashes only for represented Renma assets; non-asset reviewed files need additional file-level evidence |

Repository probing answers which visible files SkillSpector selected, but it
does not mean the example root was recognized as one Skill or one logical
subject. It broadens observed scope without improving exact content binding.

## Adapter Contract Evaluation

The classifications below describe observed SkillSpector 2.5.0 evidence only.
They do not define a receipt schema or adapter implementation.

| Candidate information | Classification | Observed evidence |
| --- | --- | --- |
| Explicit report-schema version | ambiguous | SARIF declares SARIF 2.1.0; native JSON has no explicit producer report-schema version |
| Producer name and version | available directly | SARIF exposes `skillspector` 2.5.0; JSON exposes `skillspector_version`; the harness captured the same version |
| Adapter name and version | missing | No adapter exists in this experiment |
| Exact execution mode | derivable without rescanning | Harness args include `--no-llm`; JSON reports LLM request/availability flags and analyzer states but no single mode field |
| Analyzer-level status | available directly | JSON preserves completed, disabled, and not-applicable states plus planned/completed/skipped/failed/unaccounted counters |
| Producer-native completeness | available directly | JSON exposes `is_complete`, component coverage, counts, limitations, exclusions, and ledger exceptions |
| Required-profile completeness | missing | No required profile or required-analyzer set exists to evaluate |
| Logical subject identity | ambiguous | Repository roots use native name `unknown`; absolute source identifies an invocation root, not a stable Renma subject |
| Repository-relative subject path | requires Renma BOM evidence | Native source is absolute; the harness target is repository-relative, but stable repository binding must come from Renma evidence |
| Exact reviewed component paths | available directly | JSON lists paths relative to the scan root; SARIF does not carry the full inventory |
| BOM-asset component hashes | requires Renma BOM evidence | Available only when the reviewed component is represented in BOM `assets[]` |
| Full reviewed-scope component hashes | missing | Native SkillSpector output has no component hashes, and BOM v2 does not hash every possible reviewed file; observed `renma.config.json` components demonstrate the gap |
| Component count | available directly | JSON exposes total and scanned counts |
| Stable component ordering | ambiguous | All observed lists are unique and lexicographically ordered, but no producer contract or repeatability evidence establishes stability |
| Repository revision | requires Renma BOM evidence | The evaluation records Git revision externally; native reports do not |
| Assessment-profile ID | missing | No profile ID is present |
| Assessment-profile digest | missing | No profile digest is present |
| Suppression or baseline identity | missing | Empty suppressed arrays and count zero do not identify a suppression set or baseline |
| Suppressed count | available directly | JSON exposes `suppressed_count` |
| Native assessment outcome | available directly | JSON exposes risk score, severity, and recommendation; native command exit supplies the threshold outcome |
| Native threshold outcome | derivable without rescanning | The harness preserves producer exit status and its version-specific classification |
| Raw report digest | derivable without rescanning | SHA-256 can be calculated over the published report bytes |
| Completion timestamp | available directly | JSON exposes `skill.scanned_at`; SARIF does not |
| Limitations and skipped work | available directly | JSON exposes limitations, exclusions, analyzer reason codes, and work counters; SARIF preserves limitations/exclusions only as notifications |
| SkillSpector score, recommendation, rules, and analyzer names | producer-specific extension | These values retain producer semantics and must not be normalized into Renma findings or Readiness |

An adapter parsing spike could consume the JSON component paths, raw report
digest, producer metadata, outcome, completeness, and limitations without
rescanning source content. That parse alone would not establish exact binding.
BOM v2 could bind repository-relative identity and hashes for components
represented in `assets[]`, but it could not bind the full observed scope
because the reviewed `renma.config.json` files are not hashed BOM assets.
Full-scope freshness would require producer-supplied hashes, a separate
deterministic repository file manifest, or a future additive Renma evidence
contract. This PR does not choose or implement one. SARIF is useful for native
finding interchange but is insufficient as the only binding input.

## Generalizable Renma Concepts

### Candidate provider-neutral governance concepts

The probe evidence continues to support keeping producer provenance, adapter
provenance, logical-subject binding, reviewed-scope binding, raw report digest,
producer execution, producer-native completeness, required-profile
completeness, limitations, freshness, assessment outcome, and suppression or
baseline identity as distinct concepts. The identical empty SARIF reports make
raw digest and subject/scope binding especially important to keep separate.
Reviewed-scope binding must also preserve whether file-level content evidence
covers every producer-selected component rather than infer full coverage from
the subset represented as BOM assets.

### SkillSpector-specific information

SkillSpector risk score, `LOW` severity, `SAFE` recommendation, native rule IDs
and families, individual analyzer names, heuristic filtering, generated
finding IDs, and SkillSpector's `coverage_percent` and `is_complete` semantics
must remain producer-specific. In particular, the score of 8 and favorable
recommendation do not override the two native medium-severity findings or the
disabled/not-applicable work.

### Existing Renma coverage

Renma already owns deterministic repository discovery, canonical Skill
identity and metadata, repository-relative paths, declared composition,
security-policy declarations and consistency, bounded agent-facing instruction
checks, and repository evidence such as BOM identity and content hashes where
the public BOM provides them. BOM v2 does not provide a hash for `configPath` or
promise hashes for every arbitrary reviewed file, so that existing coverage
cannot establish the full SkillSpector probe scope. The `AS3` result does not
map to an existing Renma diagnostic and should not create one through an
adapter.

### Specialized-scanner responsibility

Agent-snooping pattern detection remains SkillSpector-native. Executable-code
analysis, AST and taint analysis, dependency vulnerabilities, malware/YARA,
MCP security, and optional semantic analysis also remain specialized-scanner
responsibilities even when a particular run marks them disabled or
not-applicable.

### Insufficient evidence

The corpus does not establish stable component ordering across runs or
versions, exact content binding from native evidence, a file-level hash source
for reviewed files outside BOM `assets[]`, required-profile completeness,
suppression or baseline behavior, broad false-positive behavior, or
cross-format finding-ID stability. It also does not evaluate `allowed-tools`:
each actually reviewed canonical Skill in the probe corpus lacks that
declaration, and absence of a finding cannot imply support. Optional LLM
behavior, a safely approved static/LLM comparison, and evidence from a second
producer remain unevaluated.

## Decision-Gate Conclusion

The recommended next evidence step is a separate controlled
finding-and-suppression fixture experiment. It should test one intentional
finding, one adjudicated false-positive candidate, producer deduplication,
cross-run finding identity, and an upstream-supported suppression or baseline
path. This PR does not add that fixture or perform that experiment.

| Decision gate | Status | Evidence |
| --- | --- | --- |
| Published output can be parsed reliably | partially met | JSON and SARIF 2.1.0 parsed consistently for 2.5.0, but JSON has no explicit schema version and the two formats preserve different scope data |
| Producer version is available | met | Version 2.5.0 appears in JSON and SARIF and was independently captured by the harness; the external install receipt records the upstream commit |
| Actual execution mode is available | met | Harness args contain `--no-llm`; native LLM flags and disabled semantic analyzer states confirm static-only execution |
| Completeness and limitations are visible | met | JSON exposes `is_complete: false`, coverage, per-analyzer states and work counters, limitations, and scope exclusions |
| Logical subject can be bound | partially met | Harness target path and commit identify the requested root, but native repository subject name is `unknown` and no stable logical asset ID is present |
| Exact reviewed scope can be bound | partially met | JSON exposes included paths and one excluded path; BOM v2 can hash reviewed components represented in `assets[]`, but the observed `renma.config.json` components are not hashed BOM assets, other non-asset files may also be selected, and SARIF lacks the full inventory |
| False-positive behavior is understood | partially met | One likely false-positive pattern and exact duplicate were observed, but the corpus is too small for general behavior or stable adjudication |
| Suppression behavior is understood | not evaluated | No suppression or baseline was used; count zero only establishes the observed absence of suppression |
| Raw evidence can remain separate from Renma findings | met | Generated reports remained ignored and uncommitted; Markdown preserves native IDs and observations without creating Renma diagnostics |
| A provider-neutral core appears useful | partially met | Binding, provenance, digest, execution, completeness, limitations, and outcome remain distinct and useful, but only one producer has supplied evidence |
| Evidence from a second producer exists | not evaluated | SkillSpector remains the only evaluated producer |

## Controlled Fixture And Appium Corpus Execution Status

Executed the controlled finding, repeatability, and suppression corpus and the
read-only Appium Skills corpus on 2026-07-29 UTC. These records are additive to
the historical canonical Skill and repository-probe records above; those
records were not rerun or rewritten.

Common provenance:

- Renma revision:
  `91ec7d1bdc474783b3e7033d704bd7d8d4145594`, the fetched
  `origin/main` revision containing PR #139.
- SkillSpector executable: `/Users/kazu/.local/bin/skillspector`.
- SkillSpector version: `2.5.0`.
- Installed package source:
  `/Users/kazu/.local/share/uv/tools/skillspector/lib/python3.14/site-packages/skillspector`.
- Requested and actual mode: static-only. Every scan command contained
  `--no-llm`; JSON reported `llm_requested: false` and
  `llm_available: false`.
- Execution: direct producer commands, not the contained Renma runner. Every
  JSON and SARIF command completed with exit `0` and wrote its requested
  report.
- Raw reports, the generated controlled source, the baseline, and generated
  Renma evidence remained under `experiments/skillspector/generated/`, which is
  ignored and uncommitted.

The producer CLI and installed source were inspected before using suppression:

```text
/Users/kazu/.local/bin/skillspector --version
/Users/kazu/.local/bin/skillspector --help
/Users/kazu/.local/bin/skillspector scan --help
/Users/kazu/.local/bin/skillspector baseline --help
```

The help exposed `baseline`, `scan --baseline`, and `--show-suppressed`.
Installed `suppression.py` documented version 2 fingerprints bound to scanner
version, complete component content, rule, severity, location, and emitted
evidence. No suppression syntax was invented.

### Controlled fixture evidence

The committed fixture is inert scanner test data. Its four source files end in
`.template`, no committed fixture is named `SKILL.md`, every description labels
the content inert, and the instruction-like trigger says not to execute it.
The built-in-only preparation helper copies the templates into the ignored
generated area:

```text
node experiments/skillspector/prepare-controlled.mjs
```

Materialized targets:

| Case | Generated target | Design |
| --- | --- | --- |
| Intentional positive | `experiments/skillspector/generated/controlled-fixture/source/intentional-positive` | One inert sentence directs enumeration of installed Skills in the agent Skills directory and opening each discovered `SKILL.md` |
| Link false-positive candidate | `experiments/skillspector/generated/controlled-fixture/source/link-false-positive` | One normal same-repository Markdown link has `skills/Example/SKILL.md` as both visible text and destination; the destination is materialized from a separate inert clean template |
| Clean control | `experiments/skillspector/generated/controlled-fixture/source/clean-control` | One bounded summarization instruction with no peer-Skill or path trigger |
| Combined | `experiments/skillspector/generated/controlled-fixture/source/combined` | One generated copy of each root case under a distinct subdirectory, plus the link case's inert nested destination |

Exact unsuppressed commands followed this form, with each shown target and
output directory used once for `json`/`report.json` and once for
`sarif`/`report.sarif`:

```text
/Users/kazu/.local/bin/skillspector scan experiments/skillspector/generated/controlled-fixture/source/intentional-positive --no-llm --format <json|sarif> --output experiments/skillspector/generated/controlled-fixture/reports/intentional-positive/<report.json|report.sarif>
/Users/kazu/.local/bin/skillspector scan experiments/skillspector/generated/controlled-fixture/source/link-false-positive --no-llm --format <json|sarif> --output experiments/skillspector/generated/controlled-fixture/reports/link-false-positive/<report.json|report.sarif>
/Users/kazu/.local/bin/skillspector scan experiments/skillspector/generated/controlled-fixture/source/clean-control --no-llm --format <json|sarif> --output experiments/skillspector/generated/controlled-fixture/reports/clean-control/<report.json|report.sarif>
/Users/kazu/.local/bin/skillspector scan experiments/skillspector/generated/controlled-fixture/source/combined --no-llm --format <json|sarif> --output experiments/skillspector/generated/controlled-fixture/reports/combined-run-1/<report.json|report.sarif>
/Users/kazu/.local/bin/skillspector scan experiments/skillspector/generated/controlled-fixture/source/combined --no-llm --format <json|sarif> --output experiments/skillspector/generated/controlled-fixture/reports/combined-run-2/<report.json|report.sarif>
```

| Case | JSON SHA-256 | SARIF SHA-256 | Native findings | Native assessment |
| --- | --- | --- | --- | --- |
| Intentional positive | `fbd3ccf742397001b678654e6e3e09366c57458c7a824e8292da5a53a9761633` | `59e7dc8db9d56a8d73c33221acdc39b63f7d6255fd21b9d89c542a4abe662a4e` | one `AS3`/`MEDIUM`, `SKILL.md:10`, matched text `Enumerate installed skills` | score 8, `LOW`, `SAFE` |
| Link candidate | `91721fd87f4f96606f92e07de582a061cd091ed929a369ecb9b5bffc8d5a2ab1` | `43e4758e95c1dec05ebfbe4bfd9d9fc986ec9240327fe73851676c4500d5c122` | two `AS3`/`MEDIUM`, both `SKILL.md:9`, same matched text and explanation | score 8, `LOW`, `SAFE` |
| Clean control | `738a22e0ba9015a0c62501a0289b753803a8301ab910f4b4b47071018f431a7e` | `ac048bad24d7a13a9578dd60e770347cc4750647e521991754dd117fe59ef8d4` | none | score 0, `LOW`, `SAFE` |
| Combined run 1 | `65bdd5b94ab6e8d09e233df85042683a54a13c1942936a861aa0eb54646fb086` | `c3a06287bbc95afa9d02856e543f1565af396302a65ee41cc97d238d03a38569` | three `AS3`/`MEDIUM` | score 12, `LOW`, `SAFE` |
| Combined run 2 | `d3255c7d446d25f32dd57c3168d032a2d6ccb20e5e400ef517b85dd58d4038c3` | `87a0bff5a9e0c431b10ff3d35d44bf58f54979568af6755c351c1959f6346466` | three `AS3`/`MEDIUM` | score 12, `LOW`, `SAFE` |

Every case reported `coverage_percent: 100.0`,
`execution_successful: true`, and `is_complete: false`. Static pattern and
YARA analyzers completed; semantic analyzers were disabled by configuration.
No required assessment profile or required-analyzer set was identified, so
required-profile completeness remains unknown.

The updated link target reported two components: the root `SKILL.md` candidate
and `skills/Example/SKILL.md`, the inert clean destination. The combined target
reported four components: the three root-case `SKILL.md` files and
`link-false-positive/skills/Example/SKILL.md`. The linked target produced no
finding. Its committed template has only valid minimal `name` and `description`
Agent Skills frontmatter plus inert body text. For the standalone link target,
behavioral AST, behavioral taint, and MCP least privilege were not applicable
with `no_applicable_files`; MCP rug pull and tool poisoning completed. For the
combined target, behavioral AST and taint were not applicable with
`no_applicable_files`, MCP least privilege and tool poisoning were not
applicable with `manifest_absent`, and MCP rug pull completed. Meta analysis and
all three semantic analyzers were disabled in both scopes; all static pattern
and YARA work completed for both components or all four components,
respectively.

The intentional-positive result is actionable within the fixture's deliberate
threat model: the native AS3 explanation is exactly about enumerating or
reading peer installed Skills. The committed template remains inert test data,
so no operational asset should be changed in response.

The link candidate reproduced the PR #139 false-positive mechanism more
narrowly. The producer emitted one result for the Markdown label and one for
the identical destination even though that relative path now resolves to the
materialized inert clean target. Both results have the same rule, severity,
file, line, matched text, snippet, explanation, remediation, and confidence,
but different generated IDs. Human review classifies both as duplicate
false-positive candidates for this valid benign link, not as evidence that
every AS3 result is false.

The producer published both duplicate issues and reported
`findings_before_filtering: 2` and `findings_after_filtering: 2`, but assigned
the same score 8 as the one-finding intentional target. Installed `report.py`
applies `deduplicate(active_findings)` only to scoring while rendering the
active finding list. The combined target likewise published all three issues
while scoring the two distinct matched-text causes.

### Cross-run and cross-format finding identity

The combined source did not change between runs. JSON and SARIF each preserved
the same three semantic results in this order:

```text
intentional-positive/SKILL.md:10 AS3 Enumerate installed skills
link-false-positive/SKILL.md:9 AS3 skills/Example/SKILL.md
link-false-positive/SKILL.md:9 AS3 skills/Example/SKILL.md
```

Rule IDs, native severities, locations, snippets, explanations, confidence,
assessment, component order, analyzer states, coverage, completion, and result
ordering were equal across the two runs. Producer-generated IDs were not:

```text
combined run 1 JSON:
  finding-9d55e8b9965d478a9a1edc5b83f11613
  finding-56d48b3f9a9e471d8c0b09881badaaa9
  finding-b2859732ba954bb784ae4438355c259d
combined run 2 JSON:
  finding-05e7d0b8158e4b15bb48b14f67c7cfeb
  finding-28004cab4407456b99a6d1c04c0c4e63
  finding-6496eab0974f4b6e8aa853982dfa0b0e
combined run 1 SARIF:
  finding-ad39da308ff94b7c900744d9079727e0
  finding-7b0ef374cad446ba806926126edd7115
  finding-3149adefe1fa4699a0920c87f668857a
combined run 2 SARIF:
  finding-7f8637b6562c4d29a5a74ad827ac3f0b
  finding-524577e76e5d432385b5d2a85b768d5d
  finding-290207935eec417a8f6c4ae1286b3160
```

The same format-to-format distinction appeared in the single cases. The
intentional-positive JSON/SARIF IDs were
`finding-93de6910897e46a1bb424d271d55ea51` and
`finding-a4d93583d5b0498ea14380644f2d78e2`; the link JSON IDs were
`finding-4014c21cf6e2443490cad574d9227dac` and
`finding-e1beec42bb704e639e19caf6301271bd`, while SARIF used
`finding-f3d28ca7a1b34bdeba25654a30d7fff2` and
`finding-05e2ad330a0a492d93100de1a39a1c07`.

The raw combined digests differed in both formats. After removing only
`skill.scanned_at` and every JSON `finding_id`, then serializing with sorted
keys, the two JSON objects were equal and both had experiment-comparison SHA-256
`84cb5fa18f0f1ffaaf7076d2b604f119d94e81babb075877c9e8849d73da2a17`.
After removing only SARIF `properties.findingId` and serializing with sorted
keys, the two SARIF objects were equal and both had experiment-comparison
SHA-256
`29e1cc3dc5138a533c0a9d2c8a30be12a760c88e98fd1c01c1ec8176a8008705`.
These normalization digests are observations, not a proposed canonical report
or finding-identity contract.

The evidence therefore keeps these concepts separate:

- semantic finding identity was stable for two unchanged runs;
- producer-generated finding ID was deliberately run-unique and unstable;
- cross-format semantic identity was available from native evidence fields,
  but cross-format generated IDs did not match;
- cross-run semantic identity was available for this fixture and version;
- raw report digest identity was not stable because JSON timestamps and both
  formats' generated IDs changed.

### Suppression or baseline observations

#### Single-finding suppression mechanics

The narrow selected finding was the sole intentional-positive AS3 result. The
exact supported baseline commands were:

```text
/Users/kazu/.local/bin/skillspector baseline experiments/skillspector/generated/controlled-fixture/source/intentional-positive --no-llm --output experiments/skillspector/generated/controlled-fixture/baseline/intentional-positive.json --reason 'Controlled experiment: suppress only the intentional AS3 finding'
/Users/kazu/.local/bin/skillspector scan experiments/skillspector/generated/controlled-fixture/source/intentional-positive --no-llm --baseline experiments/skillspector/generated/controlled-fixture/baseline/intentional-positive.json --show-suppressed --format json --output experiments/skillspector/generated/controlled-fixture/reports/intentional-positive-suppressed/report.json
/Users/kazu/.local/bin/skillspector scan experiments/skillspector/generated/controlled-fixture/source/intentional-positive --no-llm --baseline experiments/skillspector/generated/controlled-fixture/baseline/intentional-positive.json --show-suppressed --format sarif --output experiments/skillspector/generated/controlled-fixture/reports/intentional-positive-suppressed/report.sarif
```

The local version 2 baseline SHA-256 was
`b82a96bb13ee540ab7b5bc5a69f18c219b3104cf71ee62b37610240d89be4563`.
It contained one scanner-version-bound fingerprint,
`sha256:433c160590f33f55ec646cb46067d2188215441bc36a14b91af8b754d119bfa7`,
for `AS3` in `SKILL.md`, with the recorded reason. It remained ignored and
uncommitted.

Suppressed report SHA-256 values were
`5333c7cd618b737b7e120245d1bb68e58f40586af3c0b1218cccf8cae47a810e`
for JSON and
`6f5066f02d9ca7fe626b3b9f5511c92ef2d868d373b560dd91f1978c4a851a61`
for SARIF.

Before suppression, JSON had one active issue, `suppressed_count: 0`, score 8,
and generated ID `finding-93de6910897e46a1bb424d271d55ea51`.
After suppression:

- JSON had zero active `issues`, `suppressed_count: 1`, and retained the full
  finding in `suppressed` with `suppressed: true`, the human reason, and a new
  ID `finding-e67d0f729d9f463ab863370ca5c5c568`;
- SARIF retained the result with an external suppression and the human reason,
  and used another new ID,
  `finding-84b98fee23054a738ad837b291916a04`;
- score changed from 8 to 0; native severity `LOW`, recommendation `SAFE`, and
  exit `0` did not change;
- `findings_before_filtering: 1` and `findings_after_filtering: 1` did not
  change because baseline suppression occurs after producer filtering;
- execution success, `coverage_percent: 100.0`, `is_complete: false`,
  component counts, analyzer states, and limitations did not change.

The native outputs include the suppression reason but not the baseline digest,
baseline fingerprint, or another suppression-set identity. A future adapter
would have to preserve the separately calculated baseline digest if governance
needs suppression identity. No unrelated finding existed in this one-finding
target; the controlled link and clean targets were not passed the baseline.

#### Multi-finding suppression selectivity

The selective experiment used the updated, unchanged four-component combined
target. The producer-native version 2 baseline command was:

```text
/Users/kazu/.local/bin/skillspector baseline experiments/skillspector/generated/controlled-fixture/source/combined --no-llm --output experiments/skillspector/generated/controlled-fixture/baseline/combined-selective.full.json --reason 'Controlled experiment: suppress only the benign Markdown-link false-positive cause'
```

SkillSpector reported three suppressible findings, but serialized two exact
fingerprints: one for the intentional positive and one shared by both duplicate
link findings. Human review removed the intentional-positive entry and retained
only the producer-generated link entry:

```text
version: 2
scanner_version: 2.5.0
rule_id: AS3
file: link-false-positive/SKILL.md
fingerprint: sha256:6372a25537b41af0a1be584274ac867f838dac733b2be538357b103547a6dbf8
reason: Controlled experiment: suppress only the benign Markdown-link false-positive cause
```

The narrowed baseline SHA-256 was
`633fa77a9e7cad0a31b365b78d85743d7e6756327424571a46ac852f9f3270bd`.
Both the full generated baseline and the narrowed baseline remained ignored and
uncommitted. The selective scan commands were:

```text
/Users/kazu/.local/bin/skillspector scan experiments/skillspector/generated/controlled-fixture/source/combined --no-llm --baseline experiments/skillspector/generated/controlled-fixture/baseline/combined-selective.json --show-suppressed --format json --output experiments/skillspector/generated/controlled-fixture/reports/combined-selective/report.json
/Users/kazu/.local/bin/skillspector scan experiments/skillspector/generated/controlled-fixture/source/combined --no-llm --baseline experiments/skillspector/generated/controlled-fixture/baseline/combined-selective.json --show-suppressed --format sarif --output experiments/skillspector/generated/controlled-fixture/reports/combined-selective/report.sarif
```

Selective report SHA-256 values were
`330719ef1520e893d7a81f5765da7611d1a04a1478321b5a9c825c11e621484c`
for JSON and
`8273f167b5aacd4d190b73d541255ff352d1c3f6e46877fbd493cfb02c866bfb`
for SARIF. Both commands exited `0`.

The unsuppressed combined report had three active issues, zero suppressed
findings, score 12, native severity `LOW`, and recommendation `SAFE`. With the
narrowed exact fingerprint:

- the intentional `AS3` positive remained the one active JSON issue, at
  `intentional-positive/SKILL.md:10`, with generated ID
  `finding-bc7d9922e962434d9b692a2d7e6090e6`;
- both duplicate link findings moved into JSON `suppressed`, each with
  `suppressed: true`, the retained human reason, and generated IDs
  `finding-3234533feab649dab10a9e10ff484e51` and
  `finding-14a0377930744fb7a3f977f8ae26c1f8`;
- active issue count was 1 and `suppressed_count` was 2;
- SARIF retained the intentional result as active with generated ID
  `finding-13132cc996a941729fb4192e5c238ecc`, and retained both link results
  with `external` suppressions, the same reason, and generated IDs
  `finding-9bc1ce782b814057a88e0c8e8a613199` and
  `finding-f1e0f5046ac5451190903e6bbc5984cc`;
- score changed from 12 to 8 while native severity `LOW`, recommendation
  `SAFE`, and exit `0` remained unchanged;
- `findings_before_filtering: 3` and `findings_after_filtering: 3` remained
  unchanged because exact baseline suppression occurred after producer
  filtering.

Execution remained successful with four of four components scanned,
`coverage_percent: 100.0`, and `is_complete: false`. Component inventory,
analyzer states, limitations, ledger state, exclusions, and all completeness
counts were byte-equal as a JSON subtree before and after suppression. The
unrelated intentional positive therefore remained visible in both formats
while the one shared exact link fingerprint selectively suppressed both
duplicate results.

As in the single-finding case, native JSON and SARIF exposed the suppression
reason but neither the narrowed baseline digest nor its fingerprint identity.
This establishes exact v2 mechanics and selectivity for this unchanged corpus
under SkillSpector 2.5.0. It does not establish rule-based suppression,
source-change invalidation, scanner-version mismatch behavior, or behavior
across producer versions.

### Appium repository identity and inventory

The external corpus remained read-only:

```text
origin: git@github.com:appium/skills.git
revision: 86bb4cdf59f6aa21e5d8d179058333e5a00d1f72
status before scans: ?? view.md
```

Because the checkout was dirty before evaluation, this record does not claim
commit-exact content binding or full revision freshness. The untracked
`view.md` was not created or modified by this experiment.

The deterministic canonical inventory command found 11 Skills under one
repository Skill root:

```text
skills/appium-troubleshooting/SKILL.md
skills/prepare-development-environment/SKILL.md
skills/setup-chromium/SKILL.md
skills/setup-espresso/SKILL.md
skills/setup-gecko/SKILL.md
skills/setup-mac2/SKILL.md
skills/setup-safari/SKILL.md
skills/setup-uiautomator2/SKILL.md
skills/setup-xcuitest/SKILL.md
skills/setup/SKILL.md
skills/xcuitest-real-device-config/SKILL.md
```

Support inventory was 85 files under `contexts/`, 13 `.mjs` files under
`tools/appium/setup/scripts/`, and seven `skills/*/agents/openai.yaml` files.
Repository configuration consisted of `renma.config.json`, Renovate and
Dependabot configuration, and one GitHub workflow. No `.skillspector` config
or baseline was present. SkillSpector's installed walker used its built-in
directory and hidden-file exclusions; it did not use `renma.config.json` or
interpret `.gitignore` rules for scope.

No `allowed-tools` declaration appeared in any canonical Skill or elsewhere in
the checkout. That is a corpus fact only, not evidence that SkillSpector
supports or rejects the syntax.

### Appium repository-root evidence

The exact root command form was:

```text
/Users/kazu/.local/bin/skillspector scan /Users/kazu/github/skills --no-llm --format <json|sarif> --output experiments/skillspector/generated/appium/root/<report.json|report.sarif>
```

JSON SHA-256 was
`62e16d01649cff3a20828295242eb4acae7e145dfe466775c8fe7140961f5d58`;
SARIF SHA-256 was
`18f9f68173670b2d8a6c0e7bab415279481b9c9efed0c2a26c8accf84f568d77`.
The producer reported:

```text
subject name: unknown
subject source: /Users/kazu/github/skills
components: 124 discovered / 124 scanned
coverage_percent: 100.0
is_complete: false
execution_successful: true
findings_before_filtering: 102
findings_after_filtering: 86
published issues: 86
suppressed_count: 0
risk assessment: score 33 / MEDIUM / CAUTION
native exit: 0
```

The exact component categories were all 85 Context files, all 11 canonical
Skill paths, all seven agent YAML files, all 13 setup scripts, and these eight
repository files:

```text
.github/dependabot.yml
.github/workflows/pr-title.yml
AGENTS.md
LICENSE
README.md
renma.config.json
renovate.json
view.md
```

Scope exclusions were `.git/` (`excluded_directory`), `.gitignore`
(`hidden_file`), and `.DS_Store` (`hidden_file`). The untracked `view.md` was a
selected component and therefore prevents a clean revision-bound root-scope
claim.

Root native findings were `AS3/MEDIUM` 62, `RP1/MEDIUM` 21, `EA3/LOW` 2, and
`P1/HIGH` 1. Human review found no source change justified by this experiment:

- AS3 matched legitimate same-repository routing and Context links;
- RP1 matched prose about explicit local `npx appium` mode, including the
  repository's `npx --no-install appium` boundary, rather than an instruction
  to fetch an unpinned MCP server;
- both EA3 results matched `not limited to` in the Apache license;
- P1 matched the heading `Enable Developer Mode` at confidence `0.21`, while
  the adjacent procedure requires local state confirmation and explicit human
  approval before any change.

These are adjudicated false-positive or governance-context candidates for this
corpus, not a claim that these native rules are generally false. AS3, RP1,
EA3, and P1 remain specialized producer rules and were not translated into
Renma diagnostic IDs. The ordered 86-ID JSON list had SHA-256
`01398014e579a13d2ec5b3c8ea310af1f02e70dcc45440eddc4388bcd9328990`;
the IDs remain opaque run-local values, not finding identities.

The root labeled every `.mjs` script as `type: other`,
`executable: false`, and reported `has_executable_scripts: false`.
Behavioral AST and taint were therefore `not_applicable` with
`no_applicable_files`. MCP least privilege and tool poisoning were
`not_applicable` with `manifest_absent`; meta and all three semantic analyzers
were disabled; static pattern, YARA, and MCP rug-pull work completed. Thus
`coverage_percent: 100.0` did not mean the selected JavaScript received AST or
taint analysis.

Logical-subject binding was `unknown`: the absolute invocation root and dirty
Git evidence identify the requested checkout, but native name `unknown` does
not represent one logical Skill. Reviewed-scope binding was `partial`: JSON
listed selected and excluded paths, but native output supplied no content
hashes or repository revision and SARIF supplied no complete inventory.

### Appium per-Skill evidence

For every row below, the exact command was:

```text
/Users/kazu/.local/bin/skillspector scan <absolute-target> --no-llm --format <json|sarif> --output experiments/skillspector/generated/appium/<target-id>/<report.json|report.sarif>
```

`<absolute-target>` is `/Users/kazu/github/skills/skills/<target-id>` for each
listed target. Every command exited `0`, wrote its report, reported
`execution_successful: true`, `coverage_percent: 100.0`,
`is_complete: false`, and `suppressed_count: 0`, with no scope exclusions.

| Target | Components | Native findings | Before/after | Assessment | JSON SHA-256 | SARIF SHA-256 |
| --- | ---: | --- | --- | --- | --- | --- |
| `appium-troubleshooting` | 1 | RP1/MEDIUM 1; AS3/MEDIUM 3 | 4/4 | 21/MEDIUM/CAUTION | `fb6b6999aa93acf8e6171fcd89bca24758d05776b5db48ecf49daef0f8543a22` | `90d15631f96d3aede257aa1d2eb92c8598ab3a1d7e00fc1078af6d76918b7a92` |
| `prepare-development-environment` | 1 | AS3/MEDIUM 3 | 3/3 | 14/LOW/SAFE | `f565f95b1472bdafb2c069ac5ba90ad4ba7c152a016fece2bf19f4f71d904f1d` | `9bfbfc0a0427ab7cb4d2687106cea5c04f5f95f3ad4b2445b2f5627e1f641546` |
| `setup` | 1 | RP1/MEDIUM 1; AS3/MEDIUM 6 | 7/7 | 21/MEDIUM/CAUTION | `354a43a3c5239336d6dfe16a701e0e3d865b4c814f7afc48bd04108923d31876` | `755cd897d5578dd42f53187c2de04964096e3028f09513d460594919a64fd7a9` |
| `setup-chromium` | 2 | RP1/MEDIUM 1 | 1/1 | 7/LOW/SAFE | `1e4b29c1e70d0e0c808231eb75af933e9ca4bf96db058581577d15f3a8149e31` | `af388316166cfc5a650a3a21ff33b546999f2a15f620f4994d64aeaa1eb37e9e` |
| `setup-espresso` | 2 | RP1/MEDIUM 1 | 1/1 | 7/LOW/SAFE | `9ba7c6b27382af8c92273fedbcdfbf818cf662ea311b36df3af698aad583a68c` | `18c6b57e0dbe2c7a31617b76f52df874f1bf0a5e0aaa42213fc5410712bdcec5` |
| `setup-gecko` | 2 | RP1/MEDIUM 1 | 1/1 | 7/LOW/SAFE | `1e1471cc8d43967d2ea189ca802e95d084ff9ddeac05bab3052355ceed2e8a4b` | `b724520ed3fadd15abd0da52d9178b33c195a0a1ea69b0bfc513202095e5c428` |
| `setup-mac2` | 2 | RP1/MEDIUM 1 | 1/1 | 7/LOW/SAFE | `ce6e783878c1442d45f4232462a3aeed67be46eb536d10ae055a32b405142b4a` | `70a639821e474b13cfb5b95985e626af95ffb4cde719ded1ccc39b99c59231a4` |
| `setup-safari` | 2 | RP1/MEDIUM 1 | 1/1 | 7/LOW/SAFE | `e61fe1165b23da57a548b4ba1ab8116301d4829dd9adc3bd1e69fb1194d19a98` | `e4d4c1cc3343483bc527ccec303ec14ec10f4e936398581ee1899c5fcffa4187` |
| `setup-uiautomator2` | 2 | RP1/MEDIUM 1; AS3/MEDIUM 1 | 2/2 | 15/LOW/SAFE | `1c3b48e98d550610bb99dccd137d43ab86b6ac5fca0368a7ab00a1141ca50736` | `e52697c8465a9b37f33f0c999740182bb6fa166c9d03f199be24d3b41325ac02` |
| `setup-xcuitest` | 2 | RP1/MEDIUM 1; AS3/MEDIUM 2 | 3/3 | 19/LOW/SAFE | `46acbd8dada6b36a058c72da71194b4caafb01b635f9409b64257fa9f1bc72d1` | `c4b389e79db3dfcc0348b311350edb2ec71b86b855b128478f7cccf2b65b96bd` |
| `xcuitest-real-device-config` | 1 | RP1/MEDIUM 2; AS3/MEDIUM 3 | 5/5 | 19/LOW/SAFE | `1af034710bfbed8cb0648934b78647c74172dff881dbbddec0c43ea345a95630` | `b40a056048b72f4a9124b07b5825badf899c6e65645c444a2bcce6cbd3dd6fcd` |

One-component inventories contained only `SKILL.md`. Every two-component
inventory contained `SKILL.md` and `agents/openai.yaml`. Per-Skill JSON native
names matched the canonical Skill names; sources were absolute.

Common analyzer states were: behavioral AST, behavioral taint, and MCP least
privilege `not_applicable/no_applicable_files`; MCP rug pull and MCP tool
poisoning completed; meta and three semantic analyzers disabled; static
patterns and YARA completed. The repeated disabled-analyzer messages were the
only reported limitations.

Human review classified every per-Skill AS3 result as a legitimate
same-repository routing or continuation link and every RP1 result as prose
about explicitly selected local `npx appium` mode. No Appium source change was
actionable from this experiment. Renma represents the routing relationships
as declared composition, but that is not a Renma diagnostic overlap with AS3;
RP1 is also specialized-scanner-only.

The per-Skill JSON generated IDs were:

```text
appium-troubleshooting: finding-8abee247300749b8a0f2851d8522feb8, finding-3f45f41439f14e2fa9a9d4e3199c7c36, finding-b2ea5a0350c94fecbb5980e449cefc47, finding-ac068888a4f248cd85ab5fc50878d7a2
prepare-development-environment: finding-6fdd9c65d9cf435699990eac401f6b99, finding-c44e245b07fd4a298ea4a90887422c22, finding-7b0a72cf9761415ea23115e222eb227f
setup: finding-00d081e5b77143958f9e535d1c6388a9, finding-3dbef337faa7448e850746f11806d02d, finding-c51b644e614d472f8cbc6e0d4525a7ab, finding-7f56643f240141029e58e01268cb8032, finding-e60877af4c72401086a80a2b912204c6, finding-0fbf792a8ff64176a3f58dd539f8d0c0, finding-f509f8af20a34379b4946d7aa84b0e13
setup-chromium: finding-4c43865f55ad4eb689ebd07e0f5a86e7
setup-espresso: finding-412ef8f0b4ff4222aa385641687dd90b
setup-gecko: finding-25f5f6b8e677404ea629afb03bab6dde
setup-mac2: finding-f269a84f427d4eb78cb6a76319aaf9f0
setup-safari: finding-9fcdeb8cee5c410f899475b43a4f9969
setup-uiautomator2: finding-7c09e76eaa9247ec853af78a7915e3b2, finding-cc8d861d6b994bec94032108190a5e1c
setup-xcuitest: finding-c1ab4b627dcd41248314856ef45067b5, finding-52ea5bd21693474c9a9f8033109f877d, finding-f7a3c325127f43c9a6bc90880be1c753
xcuitest-real-device-config: finding-72d13aca326249ae85faaa309d99d6cd, finding-6b710d81831749a482a650f26340190f, finding-05a2336c2b5b4b168851df3db2bb6d82, finding-c7b2201a568849ec8eeb7f8d41da1105, finding-94a755a44dee4cd2bd42e34417ead802
```

The `setup-xcuitest` list above preserves the native report's exact IDs; as
with every other target, the separate SARIF execution used different IDs.
Across all 12 Appium targets, JSON and SARIF preserved the same semantic
finding order, count, rule, severity, location, matched evidence, and
explanation, while no same-position generated ID matched across formats.

### Root versus per-Skill comparison

All 29 per-Skill findings appeared semantically in the repository-root JSON
after making their locations root-relative. The root added 57 findings from
repository and support files. It therefore broadened scope and native
assessment; it did not preserve separate per-Skill subjects.

| Dimension | Repository root | Per-Skill |
| --- | --- | --- |
| Subject | name `unknown`; absolute repository source | canonical Skill name; absolute Skill-directory source |
| Components | 124 visible files across Skills, Contexts, configs, scripts, repository docs, and dirty `view.md` | one `SKILL.md`, plus `agents/openai.yaml` in seven targets |
| Findings | 86 after heuristic filtering | 29 total across 11 reports |
| Duplicate behavior | 102 before and 86 after producer filtering; repeated path causes remained in different files/lines | repeated path causes within each Skill remained when locations differed |
| Analyzer applicability | JavaScript still labeled non-executable; MCP manifest absent | agent YAML selected in seven targets; MCP tool poisoning completed, least privilege remained not applicable |
| Completeness | 124/124, 100%, `is_complete: false` | all components scanned, 100%, `is_complete: false` |
| SARIF scope | findings and three exclusion notifications, no full inventory | findings and limitations, no full inventory |

The root scan did not represent one logical Skill. Repository-root and
per-Skill report digests were all distinct, but raw digest identity does not
provide subject or scope binding.

### `allowed-tools` observations

No evaluated Appium Skill declares `allowed-tools`, so no native result can
show whether SkillSpector exposes, recognizes, models, or analyzes that field.
Per-Skill MCP least-privilege status was
`not_applicable/no_applicable_files`; root status was
`not_applicable/manifest_absent`. MCP tool-poisoning completion on per-Skill
frontmatter is not evidence that `allowed-tools` was understood. This decision
gate remains `not evaluated`.

### Renma BOM binding comparison

The public commands used were:

```text
node dist/index.js catalog /Users/kazu/github/skills --format json
node dist/index.js bom /Users/kazu/github/skills --format json --omit-generated-at
node dist/index.js scan /Users/kazu/github/skills --format json
```

Generated evidence remained ignored. Renma 0.25.3 reported 11 canonical valid
Agent Skills, no Renma scan findings or diagnostics, and BOM v2 with 96 assets:
11 Skills and 85 Contexts. BOM JSON SHA-256 was
`a986bf4025f0f116dc6f05ad9f82a1a60f60fd4bcdb1e5cd88773a723b73d3b7`.

Every one of the 96 SkillSpector components that was also a BOM asset matched
the BOM `sourcePath`, and an independent byte hash matched every BOM
`contentHash`. Root-scope classification was:

| Binding class | Count | Evidence |
| --- | ---: | --- |
| Renma BOM asset with content hash | 96 | all 11 `SKILL.md` files and all 85 Context files |
| Path without content hash | 0 | no such BOM representation |
| `configPath` only | 1 | `renma.config.json` |
| Not represented by BOM v2 | 27 | repository docs/config, seven agent YAML files, 13 scripts, and dirty `view.md` |
| Ambiguous | 0 | no path collisions observed |

The exact 27 unmatched components were:

```text
.github/dependabot.yml
.github/workflows/pr-title.yml
AGENTS.md
LICENSE
README.md
renovate.json
skills/setup-chromium/agents/openai.yaml
skills/setup-espresso/agents/openai.yaml
skills/setup-gecko/agents/openai.yaml
skills/setup-mac2/agents/openai.yaml
skills/setup-safari/agents/openai.yaml
skills/setup-uiautomator2/agents/openai.yaml
skills/setup-xcuitest/agents/openai.yaml
tools/appium/setup/scripts/check-android-env.mjs
tools/appium/setup/scripts/check-bundletool-env.mjs
tools/appium/setup/scripts/check-chromium-env.mjs
tools/appium/setup/scripts/check-espresso-env.mjs
tools/appium/setup/scripts/check-ffmpeg-env.mjs
tools/appium/setup/scripts/check-gecko-env.mjs
tools/appium/setup/scripts/check-mac2-env.mjs
tools/appium/setup/scripts/check-node-env.mjs
tools/appium/setup/scripts/check-safari-env.mjs
tools/appium/setup/scripts/check-uiautomator2-env.mjs
tools/appium/setup/scripts/check-xcuitest-env.mjs
tools/appium/setup/scripts/env-check-helpers.mjs
tools/appium/setup/scripts/smoke-chromium-session.mjs
view.md
```

Per-Skill subject binding was `exact` to the current Renma evidence snapshot:
native name and scan-root path mapped to one canonical Renma Skill ID, source
path, and content hash. The four one-component targets
`appium-troubleshooting`, `prepare-development-environment`, `setup`, and
`xcuitest-real-device-config` also had `exact` current-snapshot reviewed-scope
binding because the only component was the hashed Skill asset. The other seven
targets had `partial` reviewed-scope binding because
`agents/openai.yaml` was selected but not represented by BOM v2. Root subject
binding was `unknown` and root reviewed-scope binding was `partial`.

These `exact` classifications bind the producer paths to the generated BOM
snapshot, not to Git commit
`86bb4cdf59f6aa21e5d8d179058333e5a00d1f72`; dirty checkout status keeps
commit-exact freshness unestablished. Native JSON has no component hashes or
revision, and native SARIF has no complete component inventory. BOM v2 does not
hash arbitrary external-review components, and this experiment creates no
general file-manifest contract.

### Provider-neutral candidate concepts

The new evidence supports keeping all of these concepts distinct:

- producer provenance and adapter provenance: the producer version is native,
  while no adapter exists;
- logical subject and reviewed scope: canonical per-Skill subjects could still
  include unrepresented agent YAML, while the root had broad scope but no
  logical subject;
- per-component identity and per-component content evidence: native paths were
  joinable, but only BOM assets had hashes;
- raw report digest and finding identity: raw digests changed while semantic
  findings remained stable;
- producer execution, producer-native completeness, and required-profile
  completeness: every command executed, native `is_complete` remained false,
  and no required profile existed;
- analyzer limitations and native assessment: favorable `SAFE` results and
  exit `0` coexisted with disabled/not-applicable analyzers, while root
  `CAUTION` also exited `0`;
- suppression or baseline identity and suppressed count: native count and
  rationale were visible, but baseline identity required a separate digest;
- freshness, repository revision, and dirty-state qualification: revision was
  available externally, but dirty `view.md` prevented commit-exact binding.

These observations do not define a provider-neutral schema.

### SkillSpector-specific extensions

Native score, recommendation, severity, rule IDs, analyzer names,
`coverage_percent`, `is_complete`, generated finding IDs, heuristic
before/after counts, and baseline filtering semantics remain
SkillSpector-specific. In particular:

- `AS3`, `RP1`, `EA3`, and `P1` are not Renma diagnostics;
- the producer's scoring deduplication differs from its published issue list;
- generated finding IDs are run-unique rather than stable identities;
- `coverage_percent: 100.0` can coexist with selected `.mjs` files receiving no
  AST or taint analysis;
- a suppressed finding is still visible in JSON and SARIF, but is removed from
  scoring.

### Updated decision gates and next recommendation

| Decision gate | Status | Evidence |
| --- | --- | --- |
| Published output parsing reliability | partially met | JSON and SARIF were structurally consistent across controlled and 12 Appium targets, but native JSON has no schema version and SARIF omits complete subject/scope inventory |
| Producer-version availability | met | 2.5.0 appeared in native output and the executable probe |
| Actual execution-mode availability | met | exact args and native LLM flags established static-only mode |
| Native completeness visibility | met | JSON exposed execution, coverage, `is_complete`, analyzer states, limitations, exclusions, and filtering counts |
| Required-profile completeness | not met | no profile ID, digest, or required-analyzer set existed |
| Logical-subject binding | partially met | all per-Skill subjects bound to canonical Renma assets; repository root remained native `unknown` |
| Exact reviewed-scope binding | partially met | four one-component scans bound exactly to the current BOM snapshot; seven per-Skill scans and the root included unhashed components |
| Finding-identity stability | partially met | semantic identity and order were stable across two controlled runs, but producer IDs and raw digests were not |
| Duplicate behavior | partially met | one Markdown cause predictably produced two published results while scoring deduplicated them; broader rule/version behavior remains untested |
| False-positive understanding | partially met | controlled link duplication and Appium path, `npx`, license, and Developer Mode contexts were adjudicated, but only one producer/version was evaluated |
| Suppression behavior | partially met | exact v2 fingerprint mechanics and selectivity were observed for SkillSpector 2.5.0: one shared link fingerprint suppressed both duplicates while the unrelated intentional finding remained active; rule-based suppression, source-change invalidation, scanner-version mismatch, and cross-version behavior remain untested |
| `allowed-tools` interpretation | not evaluated | the Appium corpus contains no declaration and no controlled declaration was added |
| Raw evidence remains separate from Renma findings | met | raw artifacts stayed ignored; no native result became a Renma diagnostic |
| Provider-neutral core usefulness | partially met | provenance, binding, component evidence, digest, execution, completeness, limitations, assessment, suppression, freshness, revision, and dirty state remained independently useful |
| Evidence from a second producer | not evaluated | SkillSpector remains the only producer evaluated |

The next evidence step is a separate controlled `allowed-tools` interpretation
experiment. It should test supported Agent Skills syntax and inspect native
component and analyzer evidence before any non-production adapter parsing
spike. Observation should continue without production integration, schema,
metadata, CLI, BOM, dependency, CI, or adapter implementation.

## Controlled `allowed-tools` Interpretation Execution Status

Executed the isolated `allowed-tools` corpus on 2026-07-29 UTC. This is the
final narrow SkillSpector behavior experiment in the initial producer
evaluation. It adds evidence only; it does not add an adapter or production
integration.

Common provenance:

- Renma revision:
  `d8d2f66c61307de7b71741dc8869a9dc0b3d0a69`, the fetched
  `origin/main` revision after PR #140;
- Renma version: `0.25.3`;
- SkillSpector executable: `/Users/kazu/.local/bin/skillspector`;
- SkillSpector version: `2.5.0`;
- installed package source:
  `/Users/kazu/.local/share/uv/tools/skillspector/lib/python3.14/site-packages/skillspector`;
- installation receipt: upstream
  `https://github.com/NVIDIA/skillspector.git` commit
  `34f60308522f45447cd343da0aad77bcea308ad4`;
- requested and actual mode: static-only; every producer command contained
  `--no-llm`, JSON reported `llm_requested: false` and
  `llm_available: false`, and no LLM analysis ran;
- no baseline or suppression was used; every native report recorded
  `suppressed_count: 0`;
- every JSON and SARIF command exited `0`, reported producer execution success,
  and wrote its requested ignored report.

### Specification and fixture boundary

The current Agent Skills specification describes `allowed-tools` as an
experimental space-separated string of pre-approved tools. Its current example
is:

```yaml
allowed-tools: Bash(git:*) Bash(jq:*) Read
```

Accordingly, `Read`, `WebFetch`, `Read WebFetch`, and the qualified example are
classified as current Agent Skills syntax. `Read, WebFetch` is an intentionally
non-standard producer-compatibility contrast. Omission is the field-omitted
control. A YAML-list case was not added because the portable specification
defines a string.

The first six cases use the same description, Markdown body, and
`scripts/probe.py` content; only the required Skill name and tested
`allowed-tools` declaration differ. The probe is inert scanner data. Its
uncalled function contains a local `Path.read_text()` expression and a
`requests.get` reference. It was never executed, reads no real user file, makes
no request, needs no installed `requests` package for static inspection, and
contains no secret or environment access. The docs-only case omits the probe.

No committed fixture is named `SKILL.md`. The built-in-only materializer writes
repository-shaped cases below the ignored path
`experiments/skillspector/generated/allowed-tools/repositories/`. Reports
remain under the ignored `generated/` root. The cases were not added to
`targets.json` or `package.json`.

### Renma validation

Renma was built before validation. Each generated repository was checked with
the public command forms:

```text
node dist/index.js scan experiments/skillspector/generated/allowed-tools/repositories/<case-id> --format json
node dist/index.js inspect experiments/skillspector/generated/allowed-tools/repositories/<case-id>/skills/<case-id>/SKILL.md
node dist/index.js catalog experiments/skillspector/generated/allowed-tools/repositories/<case-id> --format json
```

Repository-scoped `scan` and `catalog` each exited `0`. Every case discovered
one canonical `agent-skills` document, reported one of one Agent Skills valid
under `agentskills.io/specification@2026-07-12`, and emitted zero Agent Skills
errors or Renma authoring warnings. Catalog discovered the Skill plus the
Python script in each executable case and only the Skill in the docs-only
case, with no catalog diagnostics.

Renma therefore structurally accepts every present declaration as a string,
including the intentionally non-standard comma-delimited value. Renma does not
validate the string's internal tool grammar, so that acceptance does not make
the comma form portable Agent Skills syntax. The direct `inspect` invocation
resolved the containing Renma checkout's `.git` marker and classified these
nested generated paths as outside its recognized repository asset boundary;
repository-root `scan` is the validation evidence used here.

### SkillSpector commands and native scope

Each case used these direct static-only command forms against its canonical
Skill directory:

```text
/Users/kazu/.local/bin/skillspector scan experiments/skillspector/generated/allowed-tools/repositories/<case-id>/skills/<case-id> --no-llm --format json --output experiments/skillspector/generated/allowed-tools/reports/<case-id>/report.json
/Users/kazu/.local/bin/skillspector scan experiments/skillspector/generated/allowed-tools/repositories/<case-id>/skills/<case-id> --no-llm --format sarif --output experiments/skillspector/generated/allowed-tools/reports/<case-id>/report.sarif
```

Native subject names exactly matched the case IDs. JSON `skill.source` was the
absolute generated canonical Skill directory for each case. Each executable
case directly reported two components: non-executable Markdown `SKILL.md` and
executable Python `scripts/probe.py`, with
`has_executable_scripts: true`. The docs-only case directly reported only
non-executable `SKILL.md` and `has_executable_scripts: false`.

Every report recorded all selected components scanned,
`coverage_percent: 100.0`, execution success, no scope exclusions, and
`is_complete: false`. The static-only limitations were three disabled semantic
analyzers in every case. When active findings existed, the disabled meta
analyzer produced a fourth repeated limitation; with no findings it was
`not_applicable/no_applicable_files`. These limitations remain separate from
least-privilege applicability and native assessment.

### Comparison matrix

| Case | Spec classification | Renma valid | Executable selected | Least-privilege state | Active LP findings | Interpretation evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `no-declaration` | field omitted control | yes | yes | completed | `LP3/MEDIUM` missing declaration | direct finding establishes the omitted control and detected capabilities |
| `single-read` | current Agent Skills syntax | yes | yes | completed | `LP1/HIGH` network | behavioral: `Read` covers file read but not network |
| `single-webfetch` | current Agent Skills syntax | yes | yes | completed | `LP1/HIGH` file read | behavioral: `WebFetch` covers network but not file read |
| `standard-multi-tool` | current Agent Skills syntax | yes | yes | completed | two `LP1/HIGH`: file read and network | behavioral: the standard multi-tool string maps neither controlled token |
| `standard-qualified-tools` | current Agent Skills syntax | yes | yes | completed | two `LP1/HIGH`: file read and network | behavioral: the trailing unqualified `Read` is not independently recognized |
| `producer-comma-contrast` | intentionally non-standard producer-compatibility contrast | yes, structurally | yes | completed | none | behavioral: the producer-specific comma form covers both capabilities |
| `docs-only-standard` | current Agent Skills syntax | yes | no | `not_applicable/no_applicable_files` | none | no interpretation evidence; the analyzer did not run |

The native least-privilege state was `completed` with one planned and one
completed work item, zero skipped, failed, or unaccounted items in every
executable case. The docs-only case directly reported zero planned work and
`not_applicable/no_applicable_files`. Thus the probe changes least privilege
from not applicable to completed, while `coverage_percent: 100.0` remains true
in both states.

### Per-case report evidence

| Case | Findings before/after | Location and native explanation | Assessment | JSON SHA-256 | SARIF SHA-256 |
| --- | --- | --- | --- | --- | --- |
| `no-declaration` | 1/1 | `LP3/MEDIUM`, `SKILL.md:1`; no declaration despite detected `file_read, network` | 7/LOW/SAFE | `dd44bbbe69dc24a9a9e601563011c8c95d8a7c2872bc48507f23273b254d1bda` | `6b6a556ef49a64dfadff4d0efcb050511455ea3bac1b1640d6fc3370e9310917` |
| `single-read` | 1/1 | `LP1/HIGH`, `scripts/probe.py:1`; network not covered | 24/MEDIUM/CAUTION | `a2628365a05fd2135b95a4166be1ffcea4f3407a9a630349834bab14ed876a60` | `0826e3909cd8cf732ae39c9485f1d0ee797951912d392157824eff5db78449e5` |
| `single-webfetch` | 1/1 | `LP1/HIGH`, `scripts/probe.py:1`; file read not covered | 24/MEDIUM/CAUTION | `550eb08708af6c9a5fd984545f59edf255126581fdf3eca02f4b9cf411a88c05` | `62764b734e75717b639359b40bfa80b88157835cccfe5dee1e9fe36c4f94d226` |
| `standard-multi-tool` | 2/2 | two `LP1/HIGH`, `scripts/probe.py:1`; file read and network not covered | 24/MEDIUM/CAUTION | `d6154d2eab1b70f4273fd0230e35a8c6ecf8cf5e61724ba93c56f603287a6b89` | `dc6cdd1416e106e92c904a3ce90f699d90aeb36a2638f27be21d2a0d44c8e9a1` |
| `standard-qualified-tools` | 2/2 | two `LP1/HIGH`, `scripts/probe.py:1`; file read and network not covered | 24/MEDIUM/CAUTION | `89523d0bc56fe76645a642d8c071893d9c4fe8165828fdc9c19befcc4c4100b5` | `3af8a6c88e5749325ce7978194cd6ff6b4601bf336c963c815b1ba37492171b4` |
| `producer-comma-contrast` | 0/0 | none | 0/LOW/SAFE | `dc58ad8a2394cb9028603c125c5470bb80e728485170044f23b885ecd50c42fb` | `ac048bad24d7a13a9578dd60e770347cc4750647e521991754dd117fe59ef8d4` |
| `docs-only-standard` | 0/0 | none; least privilege not applicable | 0/LOW/SAFE | `0470f289f49b05a57ea8abe3f367785be4a475bad3d7848207efcbbfd2e4b9b7` | `ac048bad24d7a13a9578dd60e770347cc4750647e521991754dd117fe59ef8d4` |

Every result had `suppressed_count: 0`; findings before and after heuristic
filtering were equal. JSON explanations named the uncovered capability for
`LP1`. For `LP3`, SARIF's native message explicitly named both detected
capabilities, while JSON retained the rule, severity, location, confidence,
generic explanation, and remediation but serialized its finding-message field
as `null`. SARIF mapped native HIGH to `error` and MEDIUM to `warning` while
retaining native severity in result properties.

The two semantically different zero-finding cases again produced the identical
empty SARIF digest. That report alone distinguishes neither subject, executable
scope, analyzer applicability, nor interpretation of the declaration.

### Evidence levels and parsing interpretation

The evidence levels remain separate:

| Evidence level | What this experiment establishes |
| --- | --- |
| Direct native report evidence | subject name/source in JSON; component inventory and executable flags in JSON; `has_executable_scripts`; execution, coverage, completeness, analyzer state, limitations, filtering counts, findings, native assessment, and suppression count; SARIF finding messages, locations, rule IDs, native severity properties, producer version, and limitation notifications |
| Behavioral difference between controlled cases | single `Read` and `WebFetch` values cover their corresponding categories; portable space separation and the qualified standard example do not; the comma contrast covers both; omission emits LP3 |
| Installed-source explanation | the 2.5.0 manifest parser splits string values on commas and also accepts lists; the analyzer exact-matches normalized tool names to capability categories and applies LP4 over-declaration only to the producer-specific `permissions` field |
| Human inference | the standard multi-tool and qualified values are carried as non-empty declarations but not tokenized into independently recognizable standard tools; the precise intermediate representation is not report evidence |

Neither JSON nor SARIF directly exposes the raw or parsed `allowed-tools`
declaration, token boundaries, normalized tokens, mapped capability categories,
or an explicit unsupported-token limitation. Searching the native reports did
not find the source values. Interpretation is therefore behavioral, not direct
manifest evidence.

JSON preserves substantially more execution and applicability evidence than
SARIF: subject source, full component inventory, executable classification,
coverage, `is_complete`, analyzer statuses, work counters, filtering counts,
assessment, and suppression count. SARIF preserves finding messages that JSON
2.5.0 can omit, but it does not preserve the parsed declaration, full
component inventory, least-privilege state, or coverage. Neither format alone
provides positive tokenization evidence.

The evidence ladder is:

```text
frontmatter accepted
  direct Renma repository-scan evidence; SkillSpector also resolved the subject
field parsed
  behavioral evidence for simple and comma values, not a native manifest field
tokens recognized
  behavioral evidence for individual Read/WebFetch and comma-separated tokens
tools mapped to capabilities
  behavioral coverage difference for file_read and network
analyzer applicable
  direct executable inventory plus analyzer planned-work evidence
analyzer completed
  direct completed status and work counters
finding emitted or avoided
  direct LP1/LP3 findings and zero-finding contrast
```

### Required interpretation

The standards-compliant `Read WebFetch` string did not cover either controlled
capability. It emitted two under-declaration findings and behaved differently
from `Read, WebFetch`, which avoided both. Native output does not state that
the portable value became one opaque string, but installed source inspection
explains the observed result: 2.5.0 splits strings on commas, not specification
spaces, then exact-matches whole normalized entries.

The qualified standard example did not preserve independent recognition of its
trailing `Read`; file read and network were both reported under-declared. The
report does not say whether qualified names were ignored or the entire string
was treated opaquely and emits no explicit producer limitation. Installed
source shows no qualified-selector parsing and exact whole-entry mapping, but
that remains explanation rather than native report evidence.

Omission produced one native LP3 missing-declaration finding. Partial simple
declarations produced one LP1 finding for the unmatched category. A declaration
that SkillSpector interpreted as complete—the intentionally non-standard comma
contrast—avoided LP1 and LP3. The docs-only zero-finding report proves no field
interpretation because least privilege was not applicable.

No native over-declaration behavior for `allowed-tools` was observed. Installed
source limits LP4 over-declaration iteration to the separate producer-specific
`permissions` field; the reports do not disclose that limitation. This corpus
does not generalize beyond SkillSpector 2.5.0 and these controlled capabilities.

### `allowed-tools` outcome classification

SkillSpector 2.5.0 `allowed-tools` interpretation is **partially supported**.
Simple single-tool strings are recognized and mapped, so the field has an
observable effect under applicable analysis. The current portable multi-tool
space-separated form is not interpreted as required, qualified selectors do
not preserve the independent trailing `Read`, and only the intentionally
non-standard comma-delimited contrast covers both capabilities. This is a
SkillSpector 2.5.0 producer limitation, not a reason to change Renma validation
or recommend non-portable authoring syntax.

### Latest decision gates

| Decision gate | Status | Evidence |
| --- | --- | --- |
| Published output parsing reliability | partially met | 2.5.0 JSON and SARIF remain structurally readable, but JSON has no schema version, omits the LP3 finding message, and neither format exposes the declaration or tokenization; SARIF omits scope and analyzer applicability |
| Producer-version availability | met | 2.5.0 appeared in JSON, SARIF, and the executable probe; the install receipt records the upstream commit |
| Actual execution-mode availability | met | exact `--no-llm` args and native LLM flags establish static-only execution |
| Native completeness visibility | met | JSON exposes execution, coverage, `is_complete`, analyzer states, work counters, limitations, scope exclusions, and filtering counts |
| Required-profile completeness | not met | no profile ID, digest, or required-analyzer set exists |
| Logical-subject binding | partially met | canonical per-Skill subjects bind, while prior repository-root subjects remain native `unknown` |
| Exact reviewed-scope binding | partially met | this generated two-file scope is explicit in JSON and can be independently hashed, but native reports have no component hashes and prior broader scopes remain only partially represented by BOM |
| Finding-identity stability | partially met | semantic rule/capability/location identity is usable, while generated finding IDs and raw reports remain run-specific |
| Duplicate behavior | partially met | prior controlled duplication and scoring behavior are understood for one rule/version; this corpus adds no broader duplicate evidence |
| False-positive understanding | partially met | prior controlled and Appium adjudication remains useful; this corpus distinguishes producer syntax incompatibility from an actionable code defect, but only one producer/version is evaluated |
| Suppression behavior | partially met | prior exact v2 fingerprint selectivity remains established; rule-based, mutation, version-mismatch, and cross-version behavior remain unevaluated |
| `allowed-tools` interpretation | not met | simple tokens work, but current standard space-separated multi-tool and qualified-selector syntax do not; non-standard comma syntax receives the intended coverage |
| Raw evidence remains separate from Renma findings | met | all raw reports and generated Skills remain ignored; no native result became a Renma diagnostic |
| Provider-neutral core usefulness | partially met | provenance, binding, scope, digest, execution, completeness, limitations, assessment, syntax authority, and interpretation evidence remain distinct, but only one producer has supplied evidence |
| Evidence from a second producer | not evaluated | SkillSpector remains the only evaluated producer |

## Initial SkillSpector Evaluation Checkpoint

The initial SkillSpector 2.5.0 evaluation now establishes:

- canonical Skill directory scans produce usable logical subjects, while
  repository-root scans broaden component scope and can report subject
  `unknown`;
- JSON exposes selected components and executable classification, but native
  reports do not bind component content or repository revision;
- producer-native execution, coverage, completeness, analyzer applicability,
  limitations, assessment, and required-profile completeness must remain
  separate;
- the controlled and Appium corpora expose false-positive candidates,
  published duplicates, scoring deduplication, and the need for human
  adjudication;
- generated finding IDs are not stable semantic identities across executions
  or formats;
- exact version 2 baseline fingerprints can selectively suppress an
  adjudicated cause while retaining native suppressed findings, but native
  output does not identify the baseline digest;
- BOM v2 can bind represented Renma assets but not every producer-selected
  component;
- `allowed-tools` is partially supported: simple tools affect applicable
  analysis, while current portable multi-tool and qualified-selector syntax
  does not;
- static-only scans disable semantic analysis, can leave native
  `is_complete: false`, and cannot establish LLM-enabled behavior or safety;
- favorable score, severity, recommendation, zero findings, and
  `coverage_percent: 100.0` do not override disabled or non-applicable work.

The recommendation is to **evaluate a second producer** if this governance
candidate continues. Further SkillSpector-specific behavior investigation or a
SkillSpector JSON parsing spike is not justified before that comparison:
2.5.0's current-standard `allowed-tools` limitation is clear, and one producer
cannot establish provider-neutral usefulness. This PR does not implement that
recommendation and does not add a production integration, adapter, receipt
schema, metadata field, CLI, configuration field, BOM change, dependency, CI
step, raw report, generated Skill, or external-repository change.
