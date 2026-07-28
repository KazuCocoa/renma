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
separately, but exact subject and reviewed-scope binding would still need public
Renma evidence such as BOM data. The identical empty SARIF reports reinforce
that a future adapter must add binding from stable Renma repository evidence
rather than infer identity from the native report digest. This supports keeping
binding in a future adapter and keeping the native report separate.

The report distinguishes disabled, not-applicable, and completed analyzers, and
has counters for skipped, failed, and unaccounted work. The observed
`coverage_percent: 100.0` plus `is_complete: false` is important contract
evidence: producer-native completeness, required-profile completeness,
execution, and assessment must remain separate dimensions. Reliability across
producer versions, behavior with findings and suppressions, `allowed-tools`
interpretation, repository-probe behavior, future static-only requirement
satisfaction, and comparison with optional LLM output remain unresolved.
