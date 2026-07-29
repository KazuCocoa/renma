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
