# Controlled `allowed-tools` Fixtures

These files are inert security-scanner test data for the opt-in SkillSpector
experiment. They are not runnable guidance, production Skills, examples, or
assets that Renma should discover. No committed fixture is named `SKILL.md`.

Materialize the disposable, repository-shaped cases under the ignored
experiment output root:

```bash
node experiments/skillspector/prepare-allowed-tools.mjs
```

Each generated repository places its canonical Skill and optional inert probe
at:

```text
experiments/skillspector/generated/allowed-tools/repositories/<case-id>/skills/<case-id>/SKILL.md
experiments/skillspector/generated/allowed-tools/repositories/<case-id>/skills/<case-id>/scripts/probe.py
```

The cases are classified against the current
[Agent Skills specification](https://agentskills.io/specification):

| Case | Classification | Source declaration | Probe |
| --- | --- | --- | --- |
| `no-declaration` | field omitted control | omitted | file read and network |
| `single-read` | current Agent Skills syntax | `Read` | file read and network |
| `single-webfetch` | current Agent Skills syntax | `WebFetch` | file read and network |
| `standard-multi-tool` | current Agent Skills syntax | `Read WebFetch` | file read and network |
| `standard-qualified-tools` | current Agent Skills syntax | `Bash(git:*) Bash(jq:*) Read` | file read and network |
| `producer-comma-contrast` | intentionally non-standard producer-compatibility contrast | `Read, WebFetch` | file read and network |
| `docs-only-standard` | current Agent Skills syntax | `Read WebFetch` | none |

The portable cases use the specification's experimental space-separated string
form. The comma-delimited case remains a YAML string, so Renma's current
structural validator may accept it, but it is not portable Agent Skills syntax.
No YAML-list form is included because the current specification defines the
field as a string.

`probe.py.template` contains an uncalled function with recognizable file-read
and network references. It must never be executed: it reads no user file, makes
no network request, requires no installed dependency for this static-only
experiment, and exists only as scanner input.

