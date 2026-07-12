# Placeholder Tool Guide

This local tool is the fixed operational contract for the
`replace-placeholder` Skill. Run it from `examples/interactive-placeholder`.
It accepts no file path, performs no network or upload operation, and writes
only the disposable `workspace/output.txt` file.

## Commands

Prepare or reset the output from the immutable template, then inspect it:

```bash
node tools/placeholder-demo.mjs prepare
node tools/placeholder-demo.mjs inspect
```

After a user supplies a value matching `[A-Za-z0-9_-]{1,32}`, pass the
validated value as exactly one argument and inspect the result:

```bash
node tools/placeholder-demo.mjs apply EXAMPLE_VALUE
node tools/placeholder-demo.mjs inspect
```

Pass the value as an argument, never as interpolated shell source. The tool
rejects missing, extra, or invalid arguments and never accepts a destination
path.

## Behavior

- `prepare` creates `workspace/output.txt` from `assets/template.txt`. It also
  resets a completed output back to the missing-value state.
- `apply` accepts one constrained value and replaces `<placeholder>` only while
  that marker is present.
- `inspect` reports either the waiting state with `<placeholder>` or the
  complete state with the rendered value.
- `assets/template.txt` remains immutable, while the ignored workspace output
  is disposable and safe to remove.

## Failure And Stop Behavior

- If the output is missing, run `prepare` before inspecting or applying.
- If the value does not match `[A-Za-z0-9_-]{1,32}`, explain the format, ask
  again, and stop without applying.
- If `<placeholder>` is absent, stop and report the current state; use
  `prepare` only when the user wants to reset the demonstration.
- If the template lacks `<placeholder>` or a local filesystem operation fails,
  stop and report the error. Leave tracked files unchanged.
