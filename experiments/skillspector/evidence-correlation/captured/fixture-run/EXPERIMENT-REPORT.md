# Experimental SkillSpector Evidence Correlation Report

> Experimental only. This report is not a Renma product capability, public
> schema, native diagnostic source, readiness input, or CI policy.

## Research question and result

Can Renma preserve external scanner evidence as auditable facts and correlate
it with governed assets without treating the scanner's conclusions as native
Renma diagnostics?

For this fixture, **yes at the fact-and-correlation layers**. All
6 scanner findings remain present as scanner-native
objects, 4 correlate to exactly one Renma asset by an
exact repository-relative path, and 2 remain visible as
unresolved evidence. No result is converted to a Renma diagnostic or used for
readiness.

## Invocation context

| Evidence | Value |
| --- | --- |
| Renma revision | `74c53ec71a782c045c2817c1fe7703efa7f05087` |
| Fixture | `skillspector-evidence-correlation-v1` |
| Fixture scanner target | `skills/evidence-fixture` |
| Scanner | SkillSpector 2.5.0 |
| Scanner executable | `/Users/kazu/.local/bin/skillspector` |
| Scanner arguments | `scan /Users/kazu/github/renma/experiments/skillspector/generated/evidence-correlation/repository/skills/evidence-fixture --no-llm --format json --output /Users/kazu/github/renma/experiments/skillspector/evidence-correlation/captured/fixture-run/skillspector-report.json` |
| Scanner exit | 0 |
| Renma catalog arguments | `/Users/kazu/github/renma/dist/index.js catalog /Users/kazu/github/renma/experiments/skillspector/generated/evidence-correlation/repository --format json` |
| Raw scanner output | `evidence-correlation/captured/fixture-run/skillspector-report.json` |
| Raw scanner SHA-256 | `sha256:4770544e9260675d0abbb4da01b2c040f28346fe69d3da88847287d5ae2dc895` |
| Raw Renma catalog | `evidence-correlation/captured/fixture-run/renma-catalog.json` |
| Catalog SHA-256 | `sha256:6a3e01e15d7bb1ac29203ea960cef407ef9846193c17d1e30a7ee8ddf7181338` |

Raw artifact references above are relative to
`experiments/skillspector`. The fixture file hashes are
recorded in `invocation.json`. The raw report's
`skill.scanned_at`, scanner-generated finding IDs, absolute source path, and
all scanner-wide metadata are preserved rather than made reproducible-looking.
The same scanner version and fixture can reproduce the analysis, but byte-for-
byte raw output is not expected because SkillSpector emits a timestamp and
run-specific finding IDs.

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

The scanner-native assessment is reported only for audit context. Renma does
not compare it with Renma severity or readiness.

## Fixture matrix

| Required case | Concrete evidence |
| --- | --- |
| Direct asset mapping | Findings on `SKILL.md` normalize to `skills/evidence-fixture/SKILL.md` and exactly match the governed Skill asset. |
| Multiple findings on one asset | Duplicate AS3 findings remain separate on the Skill; LP1 capability findings remain separate on the script. |
| Referenced executable | Evidence 0 correlates to `skills/evidence-fixture/scripts/probe.py`; exact `owns_local_resource` and `statically_references` edges are retained. |
| Outside governed assets | Findings on `README.md` normalize inside the Skill directory, have no exact catalog asset, and remain unresolved. |
| No precise range | SkillSpector reported only a start line for every observed finding; each native `end_line` is null and the derived precision is `start-line-only`. |
| Duplicate findings | 2 group(s) compare equal after excluding only scanner-generated `finding_id`; every raw ID and record is preserved. |
| Native severity/confidence | Native values remain inside each unchanged `nativeFinding`; no common severity scale is created. |

## Concrete raw evidence

The following object is copied from the authoritative scanner report:

```json
{
  "id": "LP1",
  "finding_id": "finding-a704712c7e9f48c783a054fa24fff0f0",
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

This experimental record keeps the native object and labels every derived
layer:

```json
{
  "evidenceIndex": 0,
  "scannerFact": {
    "provenance": "scanner-output",
    "rawFindingReference": "evidence-correlation/captured/fixture-run/skillspector-report.json#/issues/0",
    "nativeFinding": {
      "id": "LP1",
      "finding_id": "finding-a704712c7e9f48c783a054fa24fff0f0",
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
    "associatedEntrypoints": [
      {
        "id": "skill.experiment.evidence-correlation",
        "kind": "skill",
        "sourcePath": "skills/evidence-fixture/SKILL.md",
        "contentHash": "sha256:1ab74c950d09dc46aff12649e6bf66514998c24aa91edf3aa13a0e413e9db99a",
        "ownership": {
          "declaredOwner": "experiment-maintainers",
          "effectiveOwner": "experiment-maintainers",
          "source": "declared"
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

The correlation result is exact path evidence from the captured Renma catalog,
not scanner policy interpretation:

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
  "associatedEntrypoints": [
    {
      "id": "skill.experiment.evidence-correlation",
      "kind": "skill",
      "sourcePath": "skills/evidence-fixture/SKILL.md",
      "contentHash": "sha256:1ab74c950d09dc46aff12649e6bf66514998c24aa91edf3aa13a0e413e9db99a",
      "ownership": {
        "declaredOwner": "experiment-maintainers",
        "effectiveOwner": "experiment-maintainers",
        "source": "declared"
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
      "finding_id": "finding-a75fd13db50542fbafd150af28549b4b",
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

- Evidence 2, 3 have same scanner-native fields except scanner-reported finding_id. Raw IDs: `finding-a75fd13db50542fbafd150af28549b4b`, `finding-660378aba3fd403b8348ebc979db4a01`.
- Evidence 4, 5 have same scanner-native fields except scanner-reported finding_id. Raw IDs: `finding-ce0f41f00e34447ea4777c7625363428`, `finding-016e63deabf24d5bb69d4afe0db7d900`.

This comparison is intentionally not a stable fingerprint. The experiment
does not merge, suppress, or discard duplicates.

## Information lost or changed during normalization

- No per-finding scanner field is lost: the complete issue object is copied
  unchanged into `scannerFact.nativeFinding`, and the full raw report remains
  authoritative.
- Report-wide SkillSpector fields are not duplicated into every evidence
  record. They remain in the referenced raw output.
- The scanner-reported file path is not overwritten. A separate derived
  repository-relative path is added with its normalization explanation.
- A location-precision label is derived from the native location. Here,
  `end_line: null` remains visible; the label does not invent an end line.
- Renma context is projected from the captured catalog. It adds identity,
  ownership, hashes, exact entrypoint relationships, and dependencies without
  changing scanner semantics.

## Scanner-specific fields that remain opaque

- `risk_assessment.score/severity/recommendation`
- `issue category and pattern`
- `scanner-native severity and confidence`
- `explanation and remediation`
- `intent and tags`
- `filtering_mode`
- `analysis_completeness and analyzer statuses`

In particular, `LOW`, `MEDIUM`, `HIGH`, confidence numbers, score, and
recommendation retain only SkillSpector's meaning. Another scanner may expose
similar-looking values with incompatible semantics.

## Fields that appeared useful across scanners

- producer name and version with provenance;
- immutable raw-output reference and digest;
- raw finding locator and native payload;
- reported target and location, including missing precision;
- separately derived repository-relative target;
- correlation status, reason code, and human-readable explanation;
- exact Renma asset ID, path, content hash, kind, and ownership;
- exact catalog relationships and associated Skill entrypoints.

These are observations, not a universal schema. A different producer should
not be forced to provide SkillSpector's rule, severity, confidence, or
remediation model.

## Limitations and unresolved questions

- SkillSpector 2.5.0 generated run-specific finding IDs, so they are raw
  identifiers rather than stable fingerprints.
- The scanner did not report complete source ranges for these findings.
- Exact path correlation cannot bind excluded files such as this fixture's
  README, even though the scanner inspected them.
- Only one fixture, scanner version, and JSON contract are exercised here.
- The observed static-only run intentionally disables semantic analyzers, and
  producer completeness remains distinct from evidence preservation.
- The experiment does not establish how renamed assets, deleted files,
  symlinks, multiple scan roots, suppressed findings, or cross-repository
  targets should bind.
- Catalog content hashes help identify matched assets, but SkillSpector does
  not report matching per-component hashes for independent verification.

## Implications for a possible future adapter

A future SkillSpector-specific adapter could preserve the native report by
reference, copy native findings losslessly, add explicit path-normalization
provenance, and perform exact catalog correlation. It should keep unresolved
and ambiguous records, treat raw finding IDs as opaque, and keep scanner
assessment separate from any later Renma governance interpretation.

This experiment does not justify a generic adapter framework, stable public
schema, severity translation, or scanner-triggered policy. More versions and
failure modes should be tested inside a scanner-specific prototype before any
public boundary is proposed.

## Why findings should not affect readiness yet

- Correlation answers which asset is associated; it does not establish a
  reviewed governance rule.
- The fixture includes duplicate and deliberately false-positive-candidate
  findings, so counts and severity cannot be consumed as readiness facts.
- Static-only completeness is not equivalent to a complete review profile.
- Scanner severity, confidence, score, remediation, and recommendation are
  producer policy, not Renma policy.
- No stable finding identity, suppression governance, lifecycle behavior, or
  version-compatibility contract has been demonstrated.

## Conclusion

**Proceed toward a scanner-specific adapter prototype.** The evidence shows
that lossless native finding preservation and exact Renma asset correlation
can coexist without creating native Renma diagnostics. The prototype should
remain non-production and should next exercise report-version changes,
suppression, missing locations, unsafe paths, ambiguous catalog paths, and
scanner failures before any adapter boundary is considered stable.
