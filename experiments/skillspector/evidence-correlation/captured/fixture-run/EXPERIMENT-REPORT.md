# Experimental SkillSpector Evidence Correlation Report

> Experimental only. This report is not a Renma product capability, public
> schema, native diagnostic source, readiness input, or CI policy.

## Research question and result

Can Renma preserve external scanner evidence as auditable facts and correlate
it with governed assets without treating the scanner's conclusions as native
Renma diagnostics?

9 of 10 explicit evidence predicates passed. The projection preserved 6 scanner-native finding(s), correlated 4 by exact repository-relative path, and retained 2 unresolved finding(s), but the failed predicates prevent a positive adapter conclusion. These counts are observed facts, not evidence of complete scanner coverage.

No result is converted to a Renma diagnostic or used for readiness.

## Invocation context

| Evidence | Value |
| --- | --- |
| Renma CLI revision | `74c53ec71a782c045c2817c1fe7703efa7f05087` |
| Renma CLI executable SHA-256 | `sha256:f0aacb4c2d48310c9fc9b44229819771166a562394ee887f35bc89bdb9c8498b` |
| Git HEAD context | `30d3215a1a2a16f183aec436004d6cc4a10895bb` |
| Git worktree state | dirty |
| Experiment harness digest | `sha256:4c72cf9482a19c9dd567943605110e09b599610d567c08089a8d588792da8f3c` |
| Experiment harness files | 8 hashed file(s) |
| Revision contains exact harness | false |
| Fixture | `skillspector-evidence-correlation-v1` |
| Fixture scanner target | `skills/evidence-fixture` |
| Scanner | SkillSpector 2.5.0 |
| Scanner executable | `/Users/kazu/.local/bin/skillspector` |
| Scanner arguments | `scan /Users/kazu/github/renma/experiments/skillspector/generated/evidence-correlation/repository/skills/evidence-fixture --no-llm --format json --output /Users/kazu/github/renma/experiments/skillspector/evidence-correlation/captured/fixture-run/skillspector-report.json` |
| Scanner exit | 0 |
| Renma catalog arguments | `/Users/kazu/github/renma/dist/index.js catalog /Users/kazu/github/renma/experiments/skillspector/generated/evidence-correlation/repository --format json` |
| Raw scanner output | `evidence-correlation/captured/fixture-run/skillspector-report.json` |
| Raw scanner SHA-256 | `sha256:a2a7b455b355fe3c6fedc6c7753db12e38520d9dd3e7d32047001ae3c1370dec` |
| Raw Renma catalog | `evidence-correlation/captured/fixture-run/renma-catalog.json` |
| Catalog SHA-256 | `sha256:6a3e01e15d7bb1ac29203ea960cef407ef9846193c17d1e30a7ee8ddf7181338` |

Raw artifact references above are relative to
`experiments/skillspector`. Fixture and harness file
hashes are recorded in `invocation.json`. The Git revision is context for the
CLI and worktree; when the worktree is dirty, the harness digest and per-file
hashes—not the revision alone—identify the exact experiment implementation.
The raw report's `skill.scanned_at`, scanner-generated finding IDs, absolute
source path, and scanner-wide metadata remain authoritative.

## Scanner-native execution and completeness

| Scanner fact | Reported value |
| --- | --- |
| Top-level execution successful | true |
| Completeness execution successful | true |
| Producer `is_complete` | false |
| Analyzer statuses | completed: 20, disabled: 4 |
| Reported limitations | 4 |

These values retain SkillSpector's meaning. Disabled, partial, failed,
skipped, unaccounted, or unknown analyzer work is not reclassified as complete
coverage by the experiment.

## Results

| Observation | Count or value |
| --- | --- |
| Raw findings | 6 |
| Normalized evidence records | 6 |
| Exact asset correlations | 4 |
| Unresolved correlations | 2 |
| Ambiguous correlations | 0 |
| Duplicate groups | 2 |
| Evidence records in duplicate groups | 4 |
| Location precision | start-line-only: 6 |
| Scanner-native assessment | score 32, severity MEDIUM, recommendation CAUTION (opaque) |

The scanner-native assessment is audit context only. Renma does not compare it
with Renma severity or readiness.

## Explicit evidence predicates

| Predicate | Status | Observed |
| --- | --- | --- |
| Expected fixture identity | satisfied | skillspector-evidence-correlation-v1 |
| Producer reported successful execution | satisfied | report=true, completeness=true, exit=0 |
| Producer reported complete analysis with no disabled, failed, partial, skipped, or unknown analyzer work | not satisfied | is_complete=false, non-complete analyzer statuses=4 |
| At least one native finding | satisfied | 6 |
| At least one exact asset correlation | satisfied | 4 |
| Expected correlated skill target skills/evidence-fixture/SKILL.md | satisfied | 2 finding(s) |
| Expected correlated script target skills/evidence-fixture/scripts/probe.py | satisfied | 2 finding(s) |
| Expected unresolved target skills/evidence-fixture/README.md | satisfied | 2 finding(s) |
| Every finding has start-line-only precision | satisfied | start-line-only: 6 |
| Duplicate observations match the explicit fixture structure | satisfied | skills/evidence-fixture/README.md: 2, skills/evidence-fixture/SKILL.md: 2 |

## Fixture matrix

| Expected case | Status | Evidence actually observed |
| --- | --- | --- |
| Expected correlated skill target skills/evidence-fixture/SKILL.md | satisfied | 2 finding(s) |
| Expected correlated script target skills/evidence-fixture/scripts/probe.py | satisfied | 2 finding(s) |
| Expected unresolved target skills/evidence-fixture/README.md | satisfied | 2 finding(s) |
| Every finding has start-line-only precision | satisfied | start-line-only: 6 |
| Duplicate observations match the explicit fixture structure | satisfied | skills/evidence-fixture/README.md: 2, skills/evidence-fixture/SKILL.md: 2 |

The matrix reports expectation satisfaction rather than assuming particular
rule IDs, paths, location precision, or duplicate behavior occurred.

## Direct Skill association semantics

`directSkillAssociations` has a deliberately narrow meaning:

- a directly matched Skill associates to itself with basis
  `matched-asset-is-skill`;
- a matched non-Skill asset associates only through a direct
  `owns_local_resource` catalog edge with basis
  `direct-owns-local-resource-edge`; and
- no transitive reachability, route membership, or general entrypoint
  association is inferred.

- Directly matched Skill: evidence 4 associated to `skill.experiment.evidence-correlation` by `matched-asset-is-skill`.

- Directly owned script: evidence 0 associated to `skill.experiment.evidence-correlation` by `direct-owns-local-resource-edge`.

## Concrete raw evidence

The following object is copied from the authoritative scanner report:

```json
{
  "id": "LP1",
  "finding_id": "finding-8ebb5151de654864bd23bdd695746f37",
  "category": "MCP Least Privilege",
  "pattern": null,
  "severity": "HIGH",
  "confidence": 0.75,
  "location": {
    "file": "scripts/probe.py",
    "start_line": 1,
    "end_line": null
  },
  "finding": null,
  "explanation": "The skill uses 'file_read' capability that is not listed in its permissions. This may indicate deceptive intent or missing permission declarations.",
  "remediation": "Add the 'file_read' permission to SKILL.md, or remove the code that requires it.",
  "code_snippet": null,
  "intent": null,
  "tags": [
    "ASI02"
  ]
}
```

## Concrete normalized evidence

This experimental record keeps the native object and labels every derived layer:

```json
{
  "evidenceIndex": 0,
  "scannerFact": {
    "provenance": "scanner-output",
    "rawFindingReference": "evidence-correlation/captured/fixture-run/skillspector-report.json#/issues/0",
    "nativeFinding": {
      "id": "LP1",
      "finding_id": "finding-8ebb5151de654864bd23bdd695746f37",
      "category": "MCP Least Privilege",
      "pattern": null,
      "severity": "HIGH",
      "confidence": 0.75,
      "location": {
        "file": "scripts/probe.py",
        "start_line": 1,
        "end_line": null
      },
      "finding": null,
      "explanation": "The skill uses 'file_read' capability that is not listed in its permissions. This may indicate deceptive intent or missing permission declarations.",
      "remediation": "Add the 'file_read' permission to SKILL.md, or remove the code that requires it.",
      "code_snippet": null,
      "intent": null,
      "tags": [
        "ASI02"
      ]
    }
  },
  "normalization": {
    "provenance": "experiment-normalization",
    "target": {
      "status": "normalized",
      "scannerPath": "scripts/probe.py",
      "repositoryRelativePath": "skills/evidence-fixture/scripts/probe.py",
      "explanation": "The scanner path was normalized relative to the recorded scan target."
    },
    "locationPrecision": "start-line-only"
  },
  "correlation": {
    "provenance": "experiment-correlation",
    "status": "correlated",
    "reasonCode": "exact-repository-relative-path",
    "explanation": "The normalized target exactly matches Renma asset sourcePath \"skills/evidence-fixture/scripts/probe.py\".",
    "asset": {
      "id": "skills/evidence-fixture/scripts/probe.py",
      "kind": "script",
      "sourcePath": "skills/evidence-fixture/scripts/probe.py",
      "contentHash": "sha256:3104627512b546e4edb5870a632a929f9e1549c390666bd4db91eed6d096d9ae",
      "ownership": {
        "declaredOwner": null,
        "effectiveOwner": "experiment-maintainers",
        "source": "inherited",
        "inheritedFrom": {
          "id": "skill.experiment.evidence-correlation",
          "sourcePath": "skills/evidence-fixture/SKILL.md"
        }
      }
    },
    "directSkillAssociations": [
      {
        "basis": "direct-owns-local-resource-edge",
        "explanation": "A direct owns_local_resource catalog edge links the matched asset to this Skill.",
        "skill": {
          "id": "skill.experiment.evidence-correlation",
          "kind": "skill",
          "sourcePath": "skills/evidence-fixture/SKILL.md",
          "contentHash": "sha256:1ab74c950d09dc46aff12649e6bf66514998c24aa91edf3aa13a0e413e9db99a",
          "ownership": {
            "declaredOwner": "experiment-maintainers",
            "effectiveOwner": "experiment-maintainers",
            "source": "declared"
          }
        },
        "relationship": {
          "from": "skill.experiment.evidence-correlation",
          "to": "skills/evidence-fixture/scripts/probe.py",
          "kind": "owns_local_resource",
          "sourcePath": "skills/evidence-fixture/SKILL.md"
        }
      }
    ],
    "relationships": [
      {
        "from": "skill.experiment.evidence-correlation",
        "to": "skills/evidence-fixture/scripts/probe.py",
        "kind": "owns_local_resource",
        "sourcePath": "skills/evidence-fixture/SKILL.md"
      },
      {
        "from": "skill.experiment.evidence-correlation",
        "to": "skills/evidence-fixture/scripts/probe.py",
        "kind": "statically_references",
        "sourcePath": "skills/evidence-fixture/SKILL.md",
        "evidence": {
          "path": "skills/evidence-fixture/SKILL.md",
          "startLine": 16,
          "endLine": 16,
          "snippet": "[scripts/probe.py](scripts/probe.py)"
        }
      },
      {
        "from": "skills/evidence-fixture/scripts/probe.py",
        "to": "skill.experiment.evidence-correlation",
        "kind": "inherits_owner",
        "sourcePath": "skills/evidence-fixture/scripts/probe.py"
      },
      {
        "from": "skills/evidence-fixture/scripts/probe.py",
        "to": "skill.experiment.evidence-correlation",
        "kind": "inherits_policy",
        "sourcePath": "skills/evidence-fixture/scripts/probe.py"
      }
    ],
    "candidates": []
  }
}
```

## Concrete Renma asset context

The correlation result is exact path evidence from the captured Renma catalog, not scanner policy interpretation:

```json
{
  "provenance": "experiment-correlation",
  "status": "correlated",
  "reasonCode": "exact-repository-relative-path",
  "explanation": "The normalized target exactly matches Renma asset sourcePath \"skills/evidence-fixture/scripts/probe.py\".",
  "asset": {
    "id": "skills/evidence-fixture/scripts/probe.py",
    "kind": "script",
    "sourcePath": "skills/evidence-fixture/scripts/probe.py",
    "contentHash": "sha256:3104627512b546e4edb5870a632a929f9e1549c390666bd4db91eed6d096d9ae",
    "ownership": {
      "declaredOwner": null,
      "effectiveOwner": "experiment-maintainers",
      "source": "inherited",
      "inheritedFrom": {
        "id": "skill.experiment.evidence-correlation",
        "sourcePath": "skills/evidence-fixture/SKILL.md"
      }
    }
  },
  "directSkillAssociations": [
    {
      "basis": "direct-owns-local-resource-edge",
      "explanation": "A direct owns_local_resource catalog edge links the matched asset to this Skill.",
      "skill": {
        "id": "skill.experiment.evidence-correlation",
        "kind": "skill",
        "sourcePath": "skills/evidence-fixture/SKILL.md",
        "contentHash": "sha256:1ab74c950d09dc46aff12649e6bf66514998c24aa91edf3aa13a0e413e9db99a",
        "ownership": {
          "declaredOwner": "experiment-maintainers",
          "effectiveOwner": "experiment-maintainers",
          "source": "declared"
        }
      },
      "relationship": {
        "from": "skill.experiment.evidence-correlation",
        "to": "skills/evidence-fixture/scripts/probe.py",
        "kind": "owns_local_resource",
        "sourcePath": "skills/evidence-fixture/SKILL.md"
      }
    }
  ],
  "relationships": [
    {
      "from": "skill.experiment.evidence-correlation",
      "to": "skills/evidence-fixture/scripts/probe.py",
      "kind": "owns_local_resource",
      "sourcePath": "skills/evidence-fixture/SKILL.md"
    },
    {
      "from": "skill.experiment.evidence-correlation",
      "to": "skills/evidence-fixture/scripts/probe.py",
      "kind": "statically_references",
      "sourcePath": "skills/evidence-fixture/SKILL.md",
      "evidence": {
        "path": "skills/evidence-fixture/SKILL.md",
        "startLine": 16,
        "endLine": 16,
        "snippet": "[scripts/probe.py](scripts/probe.py)"
      }
    },
    {
      "from": "skills/evidence-fixture/scripts/probe.py",
      "to": "skill.experiment.evidence-correlation",
      "kind": "inherits_owner",
      "sourcePath": "skills/evidence-fixture/scripts/probe.py"
    },
    {
      "from": "skills/evidence-fixture/scripts/probe.py",
      "to": "skill.experiment.evidence-correlation",
      "kind": "inherits_policy",
      "sourcePath": "skills/evidence-fixture/scripts/probe.py"
    }
  ],
  "candidates": []
}
```

## Unresolved evidence example

No owner, dependency, or policy heuristic is used to force a match:

```json
{
  "evidenceIndex": 2,
  "scannerFact": {
    "provenance": "scanner-output",
    "rawFindingReference": "evidence-correlation/captured/fixture-run/skillspector-report.json#/issues/2",
    "nativeFinding": {
      "id": "AS3",
      "finding_id": "finding-bcdde5523c22425b88b55ab0576037e3",
      "category": "Agent Snooping",
      "pattern": "Skill Enumeration",
      "severity": "MEDIUM",
      "confidence": 0.8,
      "location": {
        "file": "README.md",
        "start_line": 8,
        "end_line": null
      },
      "finding": "skills/Example/SKILL.md",
      "explanation": "Skill enumerates or reads other installed skills. Access to other skills' SKILL.md files or the skills directory reveals prompt instructions, capabilities, and secrets that should be invisible to peer skills.",
      "remediation": "Remove all code or instructions that list or read other skills' files or directories. Skills should operate independently; cross-skill access is a privilege escalation.",
      "code_snippet": "\nThe following ordinary link is repeated as visible text and destination to\nexercise duplicate preservation:\n[skills/Example/SKILL.md](skills/Example/SKILL.md).",
      "intent": null,
      "tags": [
        "Agent Snooping"
      ]
    }
  },
  "normalization": {
    "provenance": "experiment-normalization",
    "target": {
      "status": "normalized",
      "scannerPath": "README.md",
      "repositoryRelativePath": "skills/evidence-fixture/README.md",
      "explanation": "The scanner path was normalized relative to the recorded scan target."
    },
    "locationPrecision": "start-line-only"
  },
  "correlation": {
    "provenance": "experiment-correlation",
    "status": "unresolved",
    "reasonCode": "no-catalog-asset-at-path",
    "explanation": "No Renma catalog asset has the exact source path \"skills/evidence-fixture/README.md\".",
    "candidates": []
  }
}
```

## Duplicate observations

- Evidence 2, 3 have same scanner-native fields except scanner-reported finding_id. Raw IDs: `finding-bcdde5523c22425b88b55ab0576037e3`, `finding-a03b406dca3a4bb095986f0a37024b61`.
- Evidence 4, 5 have same scanner-native fields except scanner-reported finding_id. Raw IDs: `finding-3bfa89e427e6485da6d883cd41ee0a3d`, `finding-3e521c49b3f24be3abeafd19d82078a7`.

This comparison is intentionally not a stable fingerprint. The experiment
does not merge, suppress, or discard duplicates.

## Information lost or changed during normalization

- No per-finding scanner field is lost: the complete issue object is copied
  unchanged into `scannerFact.nativeFinding`, and the full raw report remains
  authoritative.
- Report-wide SkillSpector fields are not duplicated into every evidence
  record. Execution and completeness facts are copied with scanner provenance,
  while the full report remains authoritative.
- The scanner-reported file path is not overwritten. A separate derived
  repository-relative path is added with its normalization explanation.
- A location-precision label is derived from each native location. The
  observed distribution is start-line-only: 6;
  the label never invents a missing line or range.
- Renma context adds identity, ownership, hashes, direct Skill associations,
  and catalog relationships without changing scanner semantics.

## Scanner-specific fields that remain opaque

- `risk_assessment.score/severity/recommendation`
- `issue category and pattern`
- `scanner-native severity and confidence`
- `explanation and remediation`
- `intent and tags`
- `filtering_mode`
- `analysis_completeness and analyzer statuses`

In particular, severity labels, confidence numbers, score, and recommendation
retain only SkillSpector's meaning. Another scanner may expose similar-looking
values with incompatible semantics.

## Fields that appeared useful across scanners

- producer name and version with provenance;
- immutable raw-output reference and digest;
- raw finding locator and native payload;
- reported execution, completeness, target, and location facts;
- separately derived repository-relative target;
- correlation status, reason code, and explanation;
- exact Renma asset ID, path, content hash, kind, and ownership; and
- exact catalog relationships and direct Skill associations with explicit
  bases.

These are observations, not a universal schema. A different producer should
not be forced to provide SkillSpector's rule, severity, confidence, or
remediation model.

## Limitations and unresolved questions

- Scanner finding IDs remain opaque raw identifiers; this experiment does not
  establish that they are stable fingerprints.
- Observed location precision is
  start-line-only: 6.
- Exact path correlation leaves 2 finding(s) unresolved
  and 0 ambiguous; it does not force a match.
- Only one fixture, scanner version, and JSON contract are exercised here.
- Producer `is_complete` is false and
  4 analyzer status(es)
  are disabled, partial, failed, skipped, unaccounted, or unknown. Producer
  completeness remains distinct from evidence preservation.
- The experiment does not establish behavior for renamed assets, deleted
  files, symlinks, multiple scan roots, suppressions, or cross-repository
  targets.
- Catalog content hashes identify matched assets, but this input does not
  establish matching producer component hashes for independent verification.

## Implications for a possible future adapter

A future SkillSpector-specific experiment could preserve the native report by
reference, copy native findings losslessly, add path-normalization provenance,
and perform exact catalog correlation. It must keep unresolved and ambiguous
records, raw finding IDs, execution, completeness, and scanner assessment
separate from any later Renma governance interpretation.

This experiment does not justify a generic adapter framework, stable public
schema, severity translation, or scanner-triggered policy.

## Why findings should not affect readiness yet

- Correlation identifies an associated asset; it does not establish a reviewed
  governance rule.
- Duplicate or deliberately controlled findings cannot be consumed as
  readiness facts.
- Producer execution and completeness are independent from preservation and
  correlation.
- Scanner severity, confidence, score, remediation, and recommendation are
  producer policy, not Renma policy.
- No stable finding identity, suppression governance, lifecycle behavior, or
  version-compatibility contract has been demonstrated.

## Conclusion

**Run another experiment before defining an adapter boundary.** The positive threshold was not met because these predicates failed: `producer.completeness`. Observed findings remain useful audit evidence, but they do not justify a positive adapter conclusion.
Future work should exercise report-version changes, suppression, missing
locations, unsafe paths, ambiguous catalog paths, and scanner failures before
any adapter boundary is considered stable.
