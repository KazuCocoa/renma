# Context Language Diagnostics

Renma checks canonical active shared context assets for small English-only wording patterns that can make reusable context harder for humans and agents to apply safely.

These diagnostics are deterministic catalog diagnostics. They do not call an LLM, infer a replacement threshold, infer a date or version, or rewrite context content.

## Scope

The checks apply only to shared context assets that are active and canonical:

- the artifact kind is `context`
- the asset has an `id` that starts with `context.`
- the asset has an `owner`
- the asset status is not `deprecated` or `archived`

## Vague wording

Renma warns when a shared context body contains broad English wording such as:

- `usually`
- `often`
- `quickly`
- `soon`
- `as needed`
- `where appropriate`
- `major`

These terms are not always wrong, but they often require a concrete condition, threshold, required evidence, or uncertainty-handling rule before the context is safe to reuse broadly.

Example warning message:

```text
Shared context asset contains vague wording "often".
```

Prefer replacing vague wording with concrete boundaries, or keep the uncertainty explicit:

```md
WDA may be involved only when session startup logs show WDA build, launch, or connection errors.
```

Do not invent thresholds or domain facts just to satisfy the diagnostic. Ask the context owner when the boundary is unknown.

## Currentness wording

Renma warns when a shared context body contains relative English currentness wording without an explicit date or version on the same line, such as:

- `recently`
- `latest`
- `currently`
- `as of now`

Example warning message:

```text
Shared context asset contains currentness wording "recently" without an explicit date or version.
```

Prefer a stable date, version, or review boundary:

```md
As of 2026-07-01, Appium driver installation guidance uses this path.
```

Versioned wording is also acceptable when it makes the claim stable:

```md
The latest Appium 2.8 behavior is covered here.
```

## Relationship to metadata diagnostics

These body-language diagnostics complement usage-boundary metadata diagnostics such as missing `when_to_use`, missing `when_not_to_use`, and placeholder usage-boundary metadata.

Keep `when_to_use` and `when_not_to_use` compact. Put detailed explanations, examples, and caveats in the Markdown body or referenced context assets.
