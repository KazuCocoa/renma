# SkillSpector Executable Relationship Correlation Report

> Experiment only. This report is not a Renma command, public schema, native
> diagnostic source, readiness input, CI policy, ownership claim, impact
> analysis, or scanner-reviewed scope.

## Research question and narrow result

When a scanner-native finding correlates exactly to a repository script, can an
experiment use Renma's public executable graph to show which Skills or scripts
directly invoke that script while keeping invocation, structural containment,
ownership, and scanner assessment semantically separate?

All 29 executable relationship predicates were satisfied. Direct Skill invokers, direct script invokers, structural containers, unresolved targets, duplicate evidence, and count consistency were observed without merging their meanings. Adapter readiness remains separately blocked by producer-native completeness (incomplete or unknown) and unresolved producer-contract gaps.

## Invocation and provenance evidence

| Evidence | Observed value |
| --- | --- |
| Fixture | `skillspector-executable-context-v1` |
| Fixture scanner target | `skills/shared-owner` |
| Scanner | SkillSpector 2.5.0 |
| Scanner executable | `/Users/kazu/.local/share/uv/tools/skillspector/bin/skillspector` |
| Scanner version probe | `SkillSpector v2.5.0` |
| Scanner arguments | `scan /Users/kazu/github/renma/experiments/skillspector/generated/evidence-correlation-executable-context/repository/skills/shared-owner --no-llm --format json --output /Users/kazu/github/renma/experiments/skillspector/evidence-correlation/executable-context/captured/fixture-run/skillspector-report.json` |
| Scanner exit | 0 |
| Renma version | 0.28.3 |
| Renma CLI revision | `8865fe43fccd4f4bfc1e15801e4807a66d459edc` |
| Renma executable SHA-256 | `sha256:f0aacb4c2d48310c9fc9b44229819771166a562394ee887f35bc89bdb9c8498b` |
| Catalog invocation | `/Users/kazu/github/renma/dist/index.js catalog /Users/kazu/github/renma/experiments/skillspector/generated/evidence-correlation-executable-context/repository --format json` |
| Catalog exit | 0 |
| Catalog stderr | empty |
| Executable graph invocation | `/Users/kazu/github/renma/dist/index.js graph /Users/kazu/github/renma/experiments/skillspector/generated/evidence-correlation-executable-context/repository --view executable --format json` |
| First executable graph exit | 0 |
| First executable graph stderr | empty |
| Repeated executable graph exit | 0 |
| Repeated executable graph stderr | empty |
| Repeated graph output byte-identical | true |
| Git HEAD context | `584edbe6e2d73331c7f5a79fbec25b267ab6b5a6` |
| Git worktree state | dirty |
| Exact harness digest | `sha256:15407ece2bd14d7b254648334cfa54dd9938a4b7d14912fd3e52b1fcebc731b3` |
| Exact harness files | 17 |
| Revision contains exact harness | false |
| Exact fixture files | 10 |

Scanner invocation, catalog invocation, and executable-graph invocation are
recorded as separate arrays in `invocation.json`. Git revision is only CLI and
worktree context; exact fixture and harness hashes qualify a dirty worktree.

## Independent raw artifacts and digests

| Source | Reference | SHA-256 |
| --- | --- | --- |
| SkillSpector JSON | `evidence-correlation/executable-context/captured/fixture-run/skillspector-report.json` | `sha256:d1dcb58b05bdf5dac3aae6f1c7a71f01b3e1e5a63be68a3330cc493edab67569` |
| Renma catalog JSON | `evidence-correlation/executable-context/captured/fixture-run/renma-catalog.json` | `sha256:87e9c415c32f2692f3905b2bb48a9e4a7adfcdbc7a6ac99195b59d2900e4ec04` |
| Renma executable graph JSON | `evidence-correlation/executable-context/captured/fixture-run/renma-executable-graph.json` | `sha256:6adc278bd2ea0ad3a112a30683aa2d3a17a3f62778d7675ab4b28e4dec767d5f` |

The raw scanner report remains authoritative for scanner-native facts. The
catalog and executable graph remain independent public Renma CLI artifacts;
the projection does not merge either into a new authoritative source.

## Producer-native execution and completeness

| Scanner fact | Reported value |
| --- | --- |
| Top-level execution successful | true |
| Completeness execution successful | true |
| Producer `is_complete` | false |
| Analyzer statuses | completed: 20, disabled: 4 |
| Non-complete analyzer entries | 4 |
| Native completeness evidence | incomplete-or-unknown |
| Reported limitations | 4 |

This input does not establish complete native analysis. Disabled, partial, failed, skipped, unaccounted, missing, or unknown analyzer work remains a producer-completeness blocker and is not reclassified as complete. Executable relationship
enrichment has a separate decision gate and does not weaken or manufacture
producer-native completeness.

## Exact fixture expectation matrix

| Case | Scanner target | Findings | Direct Skill invokers | Direct script invokers | Structural containers | Context status |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| direct-skill-invocation | `skills/shared-owner/scripts/direct-probe.py` | 1 (expected >= 1) | 1 (expected 1) | 0 (expected 0) | 1 (expected 1) | correlated: 1 |
| shared-skill-invocation | `skills/shared-owner/scripts/shared-probe.py` | 1 (expected >= 1) | 2 (expected >= 2) | 0 (expected 0) | 1 (expected 1) | correlated: 1 |
| independent-structural-containment | `skills/shared-owner/scripts/contained-probe.py` | 1 (expected >= 1) | 1 (expected 1) | 0 (expected 0) | 1 (expected 1) | correlated: 1 |
| direct-script-invocation | `skills/shared-owner/scripts/callee-probe.py` | 3 (expected >= 1) | 0 (expected 0) | 1 (expected >= 1) | 1 (expected 1) | correlated: 3 |

Expectations are predicates over observed target paths and relationship
structure. They do not depend on a particular SkillSpector rule ID.

## Correlation and relationship counts

| Observation | Count |
| --- | ---: |
| Raw scanner findings | 8 |
| Normalized evidence records | 8 |
| Exact catalog asset correlations | 6 |
| Unresolved catalog correlations | 2 |
| Ambiguous catalog correlations | 0 |
| Exact executable-node correlations | 6 |
| Unresolved executable contexts | 2 |
| Ambiguous executable contexts | 0 |
| Inconclusive executable contexts | 0 |
| Duplicate groups | 1 |
| Evidence records in duplicate groups | 2 |

Relationship counts in the matrix are distinct canonical incoming edges per
target. Duplicate scanner evidence remains separate and may reference the same
context without multiplying the graph relationship.

## Shared-script example

- `skill.experiment.executable-alpha` (skill) --`invokes`--> `skills/shared-owner/scripts/shared-probe.py` (repository-script); basis `direct-skill-invokes-edge`; provenance `experiment-executable-correlation`.
- `skill.experiment.executable-beta` (skill) --`invokes`--> `skills/shared-owner/scripts/shared-probe.py` (repository-script); basis `direct-skill-invokes-edge`; provenance `experiment-executable-correlation`.

This is direct shared use observed in canonical `invokes` edges. It is not
shared ownership or exclusive belonging.

## Containment versus invocation example

- `skill.experiment.executable-beta` (skill) --`invokes`--> `skills/shared-owner/scripts/contained-probe.py` (repository-script); basis `direct-skill-invokes-edge`; provenance `experiment-executable-correlation`.

- `skill.experiment.executable-shared-owner` (skill) --`contains`--> `skills/shared-owner/scripts/contained-probe.py` (repository-script); basis `direct-structural-contains-edge`; provenance `experiment-executable-correlation`.

`contains` and `invokes` retain different basis labels and original edge
directions. Neither relationship is derived from the other.

## Script-to-script example

- `skills/shared-owner/scripts/caller-probe.mjs` (repository-script) --`invokes`--> `skills/shared-owner/scripts/callee-probe.py` (repository-script); basis `direct-script-invokes-edge`; provenance `experiment-executable-correlation`.

The target has 0 direct Skill invoker(s).
The experiment does not traverse from the calling script to a Skill.

## One-Skill direct invocation example

- `skill.experiment.executable-shared-owner` (skill) --`invokes`--> `skills/shared-owner/scripts/direct-probe.py` (repository-script); basis `direct-skill-invokes-edge`; provenance `experiment-executable-correlation`.

## Unresolved evidence example

The exact normalized scanner target has no catalog asset, so graph correlation remains unresolved without basename, directory, containment, or ownership heuristics.

```json
{
  "evidenceIndex": 2,
  "scannerFact": {
    "provenance": "scanner-output",
    "rawFindingReference": "evidence-correlation/executable-context/captured/fixture-run/skillspector-report.json#/issues/2",
    "nativeFinding": {
      "id": "AS3",
      "finding_id": "finding-d0150164f37e49ab8c794ec0ef113b77",
      "category": "Agent Snooping",
      "pattern": "Skill Enumeration",
      "severity": "MEDIUM",
      "confidence": 0.8,
      "location": {
        "file": "README.md",
        "start_line": 6,
        "end_line": null
      },
      "finding": "skills/Example/SKILL.md",
      "explanation": "Skill enumerates or reads other installed skills. Access to other skills' SKILL.md files or the skills directory reveals prompt instructions, capabilities, and secrets that should be invisible to peer skills.",
      "remediation": "Remove all code or instructions that list or read other skills' files or directories. Skills should operate independently; cross-skill access is a privilege escalation.",
      "code_snippet": "This file is scanner-visible but deliberately excluded from the Renma catalog.\nThe following ordinary Markdown link is repeated as visible text and destination\nto preserve duplicate native evidence without creating an executable relation:\n[skills/Example/SKILL.md](skills/Example/SKILL.md).",
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
      "repositoryRelativePath": "skills/shared-owner/README.md",
      "explanation": "The scanner path was normalized relative to the recorded scan target."
    },
    "locationPrecision": "start-line-only"
  },
  "correlation": {
    "provenance": "experiment-correlation",
    "status": "unresolved",
    "reasonCode": "no-catalog-asset-at-path",
    "explanation": "No Renma catalog asset has the exact source path \"skills/shared-owner/README.md\".",
    "candidates": []
  },
  "executableContext": {
    "provenance": "experiment-executable-correlation",
    "status": "unresolved",
    "reasonCode": "catalog-correlation-unresolved",
    "explanation": "Executable correlation was not attempted because exact catalog correlation did not produce one asset.",
    "candidates": [],
    "directSkillInvokers": [],
    "directScriptInvokers": [],
    "structuralContainers": []
  }
}
```

## Duplicate preservation

- Evidence 2, 3 remain separate for `skills/shared-owner/README.md`; native IDs `finding-d0150164f37e49ab8c794ec0ef113b77`, `finding-c338ef318c8242a0949e798e4b77d11f`.

Duplicates are observations, not stable fingerprints. They are not merged,
suppressed, or converted into graph-edge counts.

## Concrete native finding and complete derived context

The complete object below is copied unchanged from the authoritative scanner output:

```json
{
  "id": "LP1",
  "finding_id": "finding-9ff1bf7adab94eddb615542ce398cba9",
  "category": "MCP Least Privilege",
  "pattern": null,
  "severity": "HIGH",
  "confidence": 0.75,
  "location": {
    "file": "scripts/callee-probe.py",
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

The corresponding experimental record preserves the native object and adds separately labeled normalization, catalog correlation, and executable context layers:

```json
{
  "evidenceIndex": 0,
  "scannerFact": {
    "provenance": "scanner-output",
    "rawFindingReference": "evidence-correlation/executable-context/captured/fixture-run/skillspector-report.json#/issues/0",
    "nativeFinding": {
      "id": "LP1",
      "finding_id": "finding-9ff1bf7adab94eddb615542ce398cba9",
      "category": "MCP Least Privilege",
      "pattern": null,
      "severity": "HIGH",
      "confidence": 0.75,
      "location": {
        "file": "scripts/callee-probe.py",
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
      "scannerPath": "scripts/callee-probe.py",
      "repositoryRelativePath": "skills/shared-owner/scripts/callee-probe.py",
      "explanation": "The scanner path was normalized relative to the recorded scan target."
    },
    "locationPrecision": "start-line-only"
  },
  "correlation": {
    "provenance": "experiment-correlation",
    "status": "correlated",
    "reasonCode": "exact-repository-relative-path",
    "explanation": "The normalized target exactly matches Renma asset sourcePath \"skills/shared-owner/scripts/callee-probe.py\".",
    "asset": {
      "id": "skills/shared-owner/scripts/callee-probe.py",
      "kind": "script",
      "sourcePath": "skills/shared-owner/scripts/callee-probe.py",
      "contentHash": "sha256:95b376b07c5f190a362f38eca789a965fd25a5812f9d42806759a571a3393fcc",
      "ownership": {
        "declaredOwner": null,
        "effectiveOwner": "experiment-maintainers",
        "source": "inherited",
        "inheritedFrom": {
          "id": "skill.experiment.executable-shared-owner",
          "sourcePath": "skills/shared-owner/SKILL.md"
        }
      }
    },
    "directSkillAssociations": [
      {
        "basis": "direct-owns-local-resource-edge",
        "explanation": "A direct owns_local_resource catalog edge links the matched asset to this Skill.",
        "skill": {
          "id": "skill.experiment.executable-shared-owner",
          "kind": "skill",
          "sourcePath": "skills/shared-owner/SKILL.md",
          "contentHash": "sha256:f57a2479e6903d9596880c77b43cf7a561c9e9df2baff543a7036b85ba0b38cf",
          "ownership": {
            "declaredOwner": "experiment-maintainers",
            "effectiveOwner": "experiment-maintainers",
            "source": "declared"
          }
        },
        "relationship": {
          "from": "skill.experiment.executable-shared-owner",
          "to": "skills/shared-owner/scripts/callee-probe.py",
          "kind": "owns_local_resource",
          "sourcePath": "skills/shared-owner/SKILL.md"
        }
      }
    ],
    "relationships": [
      {
        "from": "skill.experiment.executable-shared-owner",
        "to": "skills/shared-owner/scripts/callee-probe.py",
        "kind": "owns_local_resource",
        "sourcePath": "skills/shared-owner/SKILL.md"
      },
      {
        "from": "skills/shared-owner/scripts/callee-probe.py",
        "to": "skill.experiment.executable-shared-owner",
        "kind": "inherits_owner",
        "sourcePath": "skills/shared-owner/scripts/callee-probe.py"
      },
      {
        "from": "skills/shared-owner/scripts/callee-probe.py",
        "to": "skill.experiment.executable-shared-owner",
        "kind": "inherits_policy",
        "sourcePath": "skills/shared-owner/scripts/callee-probe.py"
      }
    ],
    "candidates": []
  },
  "executableContext": {
    "provenance": "experiment-executable-correlation",
    "status": "correlated",
    "reasonCode": "exact-executable-node-path",
    "explanation": "The catalog asset exactly matches executable graph node sourcePath \"skills/shared-owner/scripts/callee-probe.py\"; only canonical incoming edges were projected.",
    "node": {
      "id": "skills/shared-owner/scripts/callee-probe.py",
      "sourcePath": "skills/shared-owner/scripts/callee-probe.py",
      "role": "repository-script",
      "scope": "skill-local",
      "invokedBySkillCount": 0
    },
    "candidates": [],
    "invokedBySkillCountCheck": {
      "reported": 0,
      "observedDistinctDirectSkillInvokers": 0,
      "agrees": true,
      "usedToInferIdentities": false
    },
    "directSkillInvokers": [],
    "directScriptInvokers": [
      {
        "provenance": "experiment-executable-correlation",
        "basis": "direct-script-invokes-edge",
        "explanation": "Included because this canonical incoming invokes edge starts at a repository-script node.",
        "edge": {
          "from": "skills/shared-owner/scripts/caller-probe.mjs",
          "to": "skills/shared-owner/scripts/callee-probe.py",
          "kind": "invokes",
          "declaration": "executable-dependency",
          "sourcePath": "skills/shared-owner/scripts/caller-probe.mjs",
          "resolved": true,
          "targetId": "skills/shared-owner/scripts/callee-probe.py",
          "targetKind": "script",
          "targetPath": "skills/shared-owner/scripts/callee-probe.py",
          "evidenceCount": 1
        },
        "direction": {
          "source": {
            "id": "skills/shared-owner/scripts/caller-probe.mjs",
            "sourcePath": "skills/shared-owner/scripts/caller-probe.mjs",
            "role": "repository-script",
            "scope": "skill-local",
            "invokedBySkillCount": 1
          },
          "target": {
            "id": "skills/shared-owner/scripts/callee-probe.py",
            "sourcePath": "skills/shared-owner/scripts/callee-probe.py",
            "role": "repository-script",
            "scope": "skill-local",
            "invokedBySkillCount": 0
          }
        }
      }
    ],
    "structuralContainers": [
      {
        "provenance": "experiment-executable-correlation",
        "basis": "direct-structural-contains-edge",
        "explanation": "Included because this canonical incoming contains edge starts at a Skill node; the original direction is retained.",
        "edge": {
          "from": "skill.experiment.executable-shared-owner",
          "to": "skills/shared-owner/scripts/callee-probe.py",
          "kind": "contains",
          "declaration": "structural-skill-boundary",
          "sourcePath": "skills/shared-owner/SKILL.md",
          "resolved": true,
          "targetId": "skills/shared-owner/scripts/callee-probe.py",
          "targetKind": "script",
          "targetPath": "skills/shared-owner/scripts/callee-probe.py"
        },
        "direction": {
          "source": {
            "id": "skill.experiment.executable-shared-owner",
            "sourcePath": "skills/shared-owner/SKILL.md",
            "role": "skill"
          },
          "target": {
            "id": "skills/shared-owner/scripts/callee-probe.py",
            "sourcePath": "skills/shared-owner/scripts/callee-probe.py",
            "role": "repository-script",
            "scope": "skill-local",
            "invokedBySkillCount": 0
          }
        }
      }
    ]
  }
}
```

## Information added by executable correlation

- exact identity and role of the one graph node matched by repository-relative
  `sourcePath`;
- exact canonical incoming Skill-to-script `invokes` edges;
- exact canonical incoming script-to-script `invokes` edges;
- exact canonical incoming Skill-to-script `contains` edges;
- original edge direction, source and target node identity and role, narrow
  basis, and experiment provenance; and
- an explicit consistency check between `invokedBySkillCount` and distinct
  direct Skill edge identities, without using the count to invent identities.

## Information that remains unknown

- whether any invocation executes at runtime or reaches the scanner target;
- transitive callers, blast radius, impact, affected Skills, or review coverage;
- ownership, exclusive belonging, or responsibility for the matched script;
- whether SkillSpector inspected any related Skill rather than the reported
  target file;
- whether the finding is correct, exploitable, suppressed, or resolved;
- producer completeness beyond the native ledger; and
- adapter compatibility, stable field contracts, readiness, safety, or policy
  satisfaction.

## Why the relationships have narrow semantics

An incoming `invokes` edge records a direct canonical executable
relationship exposed by Renma. An incoming `contains` edge records structural
placement below one Skill's canonical scripts boundary. Neither is ownership,
runtime evidence, transitive impact, confirmed affected scope, scanner review
coverage, requirement satisfaction, or a Renma `SEC-*` finding. The experiment
does not reinterpret scanner severity, confidence, explanation, remediation,
risk score, or recommendation.

## Decision gates and conclusion

| Gate | Result |
| --- | --- |
| Executable relationship experiment | **satisfied** (29/29 predicates) |
| Adapter-boundary readiness | **blocked** — producer-native completeness (incomplete or unknown); unresolved producer-contract gaps |

Every executable relationship predicate passed. This does not alter the separate adapter-readiness gate.

Direct executable relationship enrichment is feasible from the two separate public Renma artifacts for this controlled fixture. The experiment identified direct Skill invokers, direct script invokers, and structural containers without merging those meanings, while retaining 2 unresolved executable-context record(s). It does not establish ownership, transitive impact, reviewed scope, producer completeness, adapter readiness, runtime execution, requirement satisfaction, or repository safety.
