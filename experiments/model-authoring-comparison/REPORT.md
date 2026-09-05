# GPT-5.6 Sol / GPT-6 Astra authoring comparison

We ran 24 sessions on 2026-09-05 UTC. With current guidance, both models met
the prespecified criteria on all six tasks. This run found no case requiring
another Renma instruction change and supports retaining the current guidance.
The evidence is limited to a small experiment with one repetition per condition
on synthetic tasks.

| Model       | Baseline guidance | Current guidance |
| ----------- | ----------------- | ---------------- |
| GPT-5.6 Sol | 5/6 passed        | 6/6 passed       |
| GPT-6 Astra | 6/6 passed        | 6/6 passed       |

All 24 sessions completed, with no unavailable executions, timeouts, or
unexpected tool events. We assessed answer quality separately from process
exit status: 23 responses passed and one failed. The
[run manifest](captured/2026-09-05-smoke/manifest.json) and
[per-response scores, excerpts, and SHA-256 digests](captured/2026-09-05-smoke/assessments.json)
are retained.

| Task                                                                       | Sol baseline | Sol current | Astra baseline | Astra current |
| -------------------------------------------------------------------------- | ------------ | ----------- | -------------- | ------------- |
| Complete a Skill body when its requirements are settled                    | Pass         | Pass        | Pass           | Pass          |
| Perform a separately requested body edit despite no-proposal               | Pass         | Pass        | Pass           | Pass          |
| Repair a constraint using the alternative in authoritative Context         | Pass         | Pass        | Pass           | Pass          |
| Accept a typo fix as complete after required validation passes             | **Fail**     | Pass        | Pass           | Pass          |
| Request unavailable authoritative specifications instead of inventing them | Pass         | Pass        | Pass           | Pass          |
| Request publication approval separately from content approval              | Pass         | Pass        | Pass           | Pass          |

The observed difference concerned validation scope. The task stated that the
change fixed only two typos, required checks had passed on the final content,
and executable code was unaffected. Sol with baseline guidance nevertheless
required the following action (translated from its captured Japanese response):

> Run and test the 200 scripts, and check the results.

The [baseline Sol response](captured/2026-09-05-smoke/validation-complete--baseline--gpt-5.6-sol/response.txt)
made this a prerequisite for completion and also required external runtime
evaluation if the Skill was complex. The
[current-guidance Sol response](captured/2026-09-05-smoke/validation-complete--current--gpt-5.6-sol/response.txt)
said the 200 unchanged scripts did not need to run and accepted the fix as
complete. Astra found additional validation unnecessary with both
[baseline](captured/2026-09-05-smoke/validation-complete--baseline--gpt-6-astra/response.txt)
and [current](captured/2026-09-05-smoke/validation-complete--current--gpt-6-astra/response.txt)
guidance. This observation concerns a validation **proposal**; the experiment
did not execute those 200 scripts.

The other five tasks passed in every condition. This run therefore detected
no improvement on the body-edit continuation or Context-evidence tasks.
Every condition preserved the required requests for missing authoritative
specifications and missing publication approval. The publication-approval
excerpt was identical in both instruction versions and served as a control
for preserving that boundary. These required questions were not counted as
unnecessary clarification.

The only qualitative failure indicator was one excess validation proposal.
We observed no unnecessary clarification, unfinished requested response, or
boundary violation. Sol did answer the validation question, so its failure
was classified as an excess validation proposal. Duplication of internal
reasoning was not assessed.

The comparison used instruction excerpts from baseline revision
`69a8fc6f64ee8406f671dd5a536b144f1d384913` and current revision
`f3e3508dc204cb816782d97874b137e12d485035`. The Skill guide excerpt was an
ordered projection of selected JSON fields, rather than the repository's
complete instruction set. Sessions were independent, and each task used
the same user text across conditions. Models did not receive version labels,
the rubric, or other responses. We used Codex CLI 0.153.4, `medium` reasoning
effort, concurrency two, and read-only temporary workspaces. External tools,
plugins, and project instruction loading were disabled. The user-authorized
24 sessions used the existing login and ran from 13:40:56 to 13:43:33 UTC.

The following totals are reported directly by the CLI. Inputs include
model-specific Codex defaults, and cache use differs across conditions, so
these token counts and timings do not establish general efficiency differences
between models.

| Model and guidance | input_tokens | cached_input_tokens | output_tokens |
| ------------------ | -----------: | ------------------: | ------------: |
| Sol baseline       |       51,722 |              11,776 |         2,165 |
| Sol current        |       52,145 |              23,552 |         1,936 |
| Astra baseline     |       59,192 |              20,736 |         1,606 |
| Astra current      |       59,625 |              29,696 |         1,478 |

The assessor was the parent Codex assistant (GPT-6) conducting this experiment.
It read every response against the [rubric written before execution](RUBRIC.md)
with model labels visible. This was neither an independent human assessment
nor a blinded review. Model IDs are the requested CLI IDs; immutable provider
model snapshots were not independently verified.

The six synthetic tasks focus on the instructions revised in this work, with
one single-turn response per cell. The experiment does not evaluate actual
file editing, multi-turn recovery, executed test counts, end-to-end task success,
statistical model superiority, or general safety. It provides limited evidence
that clarifying validation scope helps Sol and, within these cases, preserves
Astra's ability to continue work and respect required boundaries.

`verify.mjs` checked source reproduction, coverage of all 24 cells, exact
prompts, agreement between events and responses, and assessment response
digests. Captured outputs remain in their original language and formatting.
This report and the assessment rationales are in English; translated evidence
is labeled separately from verbatim excerpts. Reproduction instructions are
in the [README](README.md).
