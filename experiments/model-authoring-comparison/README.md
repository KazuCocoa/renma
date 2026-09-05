# Model authoring comparison

An opt-in experiment comparing GPT-5.6 Sol and GPT-6 Astra on Renma authoring
continuations. It adds no production model integration, command, dependency,
public schema, CI gate, or release requirement.

Status: all 24 sessions completed on 2026-09-05 UTC. Both models passed all six
cases with current guidance; Sol passed five with baseline guidance and Astra
passed six. See the [report](REPORT.md) and
[response-linked qualitative assessments](captured/2026-09-05-smoke/assessments.json).
This is a single-repetition smoke test, not a general model ranking.
[Setup observations](setup-observations.json) retain the connectivity checks
and review decisions. They are not task scores or a model-quality comparison.

## Design fixed before execution

- Six synthetic cases: completed authoring inputs, no-proposal plus a requested
  body edit, a constraint whose alternative is already in Context, completed
  scoped validation, missing authoritative source content, and a separate
  publication approval requirement.
- Two models, two instruction revisions, one independent session per cell:
  24 sessions. Baseline is `69a8fc6f64ee8406f671dd5a536b144f1d384913`;
  current is `f3e3508dc204cb816782d97874b137e12d485035`.
- Compare selected verbatim instruction excerpts and an explicitly ordered
  projection of guide JSON, not full installed-repository behavior. The source
  paths, selectors, full-source digests, and excerpt digests are retained.
- Same Codex CLI, `medium` reasoning, read-only disposable workspace, disabled
  external tools/plugins and no inherited project instruction files. The CLI's
  built-in instructions can still differ by model; this is a Codex-mediated
  comparison, not a claim to isolate model weights.
- Natural responses; no answer schema or expected answer is supplied. The
  [rubric](RUBRIC.md) remains outside model input. Each session receives just
  one case and one arm, without their labels or any other model's response.
- Counterbalance baseline/current order across cases. Two independent sessions
  may run concurrently. There are no automatic retries or best-of selection.

This measures next-response behavior: unnecessary questions, premature stops,
proposed redundant checks, and preservation of required boundaries. It does
not measure actual edits, executed test counts, multi-turn recovery, end-to-end
task success, runtime safety, or statistically reliable model superiority.

## Reproduce

Requires Node.js and an externally installed Codex CLI with authorized access
to both models. Uses the CLI's existing login; credentials are neither read
by the harness nor copied into this directory. Usage is charged to that login.
The run uses the official `@openai/codex@0.153.4` package, installed
under a temporary prefix without changing the global CLI. CLI 0.151.0 could
access Sol but the service rejected Astra with a newer-client requirement;
those connectivity probes are outside the scored comparison.

```bash
# Only when the committed source snapshot does not yet exist:
node experiments/model-authoring-comparison/prepare.mjs

# Refuses to overwrite any existing output directory:
RENMA_EVAL_CODEX=/path/to/codex node experiments/model-authoring-comparison/run.mjs \
  experiments/model-authoring-comparison/generated/my-run

# Offline integrity check; omitting the argument checks only the inputs:
node experiments/model-authoring-comparison/verify.mjs \
  experiments/model-authoring-comparison/generated/my-run
```

To verify the retained capture, pass
`experiments/model-authoring-comparison/captured/2026-09-05-smoke` to `verify.mjs`.

`RENMA_EVAL_CODEX` selects the CLI executable; absent it, the harness uses
`codex` on PATH. To install the pinned version separately, use
`npm install --prefix /your/temporary/directory --no-audit --no-fund --package-lock=false @openai/codex@0.153.4`
and select that directory's `node_modules/.bin/codex`.

The retained instruction sources are public repository files, verified by
anonymous HTTPS retrieval and exact SHA-256 comparison in
`inputs/public-source-verification.json`. The cases are synthetic and contain
no private user data. A fresh public-source check is available without model
calls or credentials:

```bash
node experiments/model-authoring-comparison/verify-public-sources.mjs \
  /your/temporary/directory/public-source-verification.json
```

`inputs/instructions.json` is the retained source snapshot. Regenerating it is
an intentional review action, not a requirement before every run. Runtime
model aliases may change; future runs must retain their own CLI version and
requested model IDs. The parent process needs normal CLI access to its local
state database and IPC; child model sessions remain read-only with tools
disabled. No dangerous sandbox-bypass flag is used.

Each session retains the exact prompt, actual response, filtered CLI JSONL,
redacted diagnostic stderr, timestamps, process status, response digest, and
CLI-reported token usage. Reasoning items are omitted. The capture manifest
hashes the harness, inputs, and preregistered rubric. A failed/empty session is
inconclusive, never scored as an answer. Unexpected tool items, errors, or
unparsed stdout also make a session inconclusive. `verify.mjs` checks source
reproduction, cell coverage, exact prompts, event/response agreement, and
assessment response digests without making any model calls. It does not
automatically judge whether an answer is correct.

The qualitative score file is separately authored by the parent Codex
assistant. It must name its assessor, cite each response digest, and preserve
the distinction between observed text and interpretation. Model labels are
visible during review; this is not an independent human or blinded assessment.

Official references checked during setup:

- [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol)
- [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra)
- [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)

The local CLI's `--help` and feature list supply the exact supported flags for
this capture. These references do not certify the experimental results.
