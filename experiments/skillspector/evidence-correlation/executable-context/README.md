# Executable Relationship Context Experiment

This isolated extension asks whether a scanner-native file finding that
correlates exactly to a repository script can be enriched with direct
relationship context from Renma's public executable graph. It consumes two
independent public CLI artifacts:

```bash
renma catalog <fixture-repository> --format json
renma graph <fixture-repository> --view executable --format json
```

The raw SkillSpector JSON remains authoritative for scanner-native facts. The
experimental projection adds `executableContext` only after the existing
`scannerFact`, `normalization`, and exact catalog `correlation` layers. Its
schema label has no compatibility promise.

The reviewed result is in
[`captured/fixture-run/EXPERIMENT-REPORT.md`](captured/fixture-run/EXPERIMENT-REPORT.md).
Raw scanner, catalog, and graph artifacts remain separate files with separate
digests.

## Narrow relationship meanings

The experiment selects only canonical incoming graph edges to the one node
whose repository-relative `sourcePath` exactly matches the catalog asset:

- `Skill --invokes--> repository script` becomes a direct Skill invoker with
  basis `direct-skill-invokes-edge`;
- `repository script --invokes--> repository script` becomes a direct script
  invoker with basis `direct-script-invokes-edge`; and
- `Skill --contains--> repository script` becomes a structural container with
  basis `direct-structural-contains-edge`.

The original direction, complete edge, source and target identity and role,
and experiment provenance are retained. Invocation and containment are never
derived from each other. The experiment performs no transitive traversal and
does not infer ownership, exclusive belonging, runtime execution, impact,
affected Skills, reviewed scope, scanner coverage, or requirement
satisfaction. External executable nodes cannot correlate to repository file
findings.

Missing input, a non-executable graph view, malformed or duplicate canonical
edges, absent edge endpoints, and unsupported node roles fail closed. Missing
or multiple exact graph-node matches remain unresolved or ambiguous. A
mismatch between `invokedBySkillCount` and distinct direct Skill edge
identities is inconclusive; the count never manufactures identities.

## Controlled inert fixture

Only `.template` files are committed. Preparation materializes canonical
Skills and scripts below the ignored `experiments/skillspector/generated/`
directory. No fixture instruction or script is imported or executed.

The fixture contains three Skills and five Skill-local scripts. Static scanner
tokens produce current SkillSpector-native findings for four scripts while the
public Renma graph independently exposes:

- one script directly invoked by one Skill;
- one script directly invoked by two distinct Skills;
- one contained script directly invoked by a different Skill;
- one script directly invoked by another repository script; and
- one scanner-visible README excluded from the catalog and retained as
  unresolved evidence.

Expectations use observed target paths and relationship structure rather than
hard-coded scanner rule IDs. Duplicate native findings remain separate records
even when they reference identical executable context.

## Reproduce locally

SkillSpector remains externally installed and is not a package dependency.
Build the public Renma CLI, then run:

```bash
npm run build
RENMA_SKILLSPECTOR_EXECUTABLE=/path/to/skillspector \
  node experiments/skillspector/evidence-correlation/executable-context/run-experiment.mjs
```

Ordinary output is replaced under the ignored
`experiments/skillspector/generated/evidence-correlation-executable-context/run/`
directory. The runner records raw artifacts, invocation arrays, executable
paths and versions, CLI revision and hash, exact fixture and harness hashes,
raw digests, Git revision, dirty-state qualification, a deterministic
experimental projection, and an input-driven Markdown report. It invokes the
executable graph twice and requires byte-identical JSON.

Run experiment-only tests with:

```bash
node --test experiments/skillspector/evidence-correlation/lib.test.mjs
node --test experiments/skillspector/evidence-correlation/executable-context/lib.test.mjs
```

A deliberate reviewed capture uses:

```bash
RENMA_SKILLSPECTOR_EXECUTABLE=/path/to/skillspector \
  node experiments/skillspector/evidence-correlation/executable-context/run-experiment.mjs --capture
```

Capture mode refuses to overwrite an existing capture.

## Separate decision gates

The report evaluates executable relationship predicates independently from
producer completeness. A controlled fixture may satisfy direct executable
enrichment while adapter-boundary readiness remains blocked by the producer's
native incomplete analysis and unresolved contract gaps. This experiment does
not create an adapter, integration point, diagnostic, readiness input, public
receipt, metadata field, dependency, policy, or production graph behavior.
