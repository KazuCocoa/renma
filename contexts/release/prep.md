---
id: context.release.prep
title: Release Prep Workflow
version: 0.1.0
owner: maintainers
status: experimental
tags:
  - release
  - maintenance
  - dogfooding
allowed_data: disclosed
network_allowed: true
external_upload_allowed: false
secrets_allowed: false
requires_human_approval: true
forbidden_inputs:
  - secrets
  - credentials
  - tokens
---

# Release Prep Workflow

## Summary

Renma release preparation should be grounded in local repository evidence: git history, package metadata, changelog entries, draft notes, documentation updates, tests, and Renma's own reports. The patch should make the target version reviewable before any separate distribution step.

## Scope

This context applies when:

- Preparing a new Renma release from a local checkout.
- Reconciling `CHANGELOG.md`, `package.json`, `package-lock.json`, docs, and release notes for a target version.
- Producing release evidence for review or CI.

This context does not apply when:

- Distribution work or remote repository changes.
- Updating unrelated historical release notes.
- Making general documentation edits outside a release-prep workflow.

## Workflow

1. Inspect the release state:
   - Read `package.json`, `package-lock.json`, `CHANGELOG.md`, README release-facing sections, `docs/user-manual.md`, and `docs/diagnostics.md`.
   - Identify the latest `v*` tag and compare `git log <latest-tag>..HEAD` with the changelog's `Unreleased` section.
   - Check the public release page only when network access is available or the user explicitly allows it.
2. Dogfood Renma before editing release artifacts:
   - Build the local CLI with `npm run build` if `dist/index.js` is stale or missing.
   - Run `node dist/index.js scan . --fail-on high`.
   - Run `node dist/index.js catalog . --format markdown`.
   - Run `node dist/index.js readiness . --format markdown`.
   - Run `node dist/index.js graph . --focus skill.release-prep --format mermaid`.
   - Run `node dist/index.js diff . --from <latest-tag> --to HEAD --format markdown` when the base tag is available.
   - Run `node dist/index.js ci-report . --from <latest-tag> --to HEAD --format markdown` for PR-ready release evidence.
3. Prepare release artifacts:
   - Move relevant `Unreleased` entries into a new version section with the release date.
   - Keep an empty `Unreleased` section for future changes.
   - Update `package.json` and `package-lock.json` version fields when the release requires a version bump.
   - Draft or update release notes from the changelog, Renma diff, and CI report evidence.
   - Update README, User Manual, diagnostics docs, or examples when commands, outputs, diagnostics, or user workflows changed.
4. Verify consistency:
   - Changelog entries describe user-facing changes, not only raw commit subjects.
   - Package version, changelog version, tag name, and release note title agree.
   - New or changed diagnostics are documented in `docs/diagnostics.md`.
   - Changed commands or output formats are documented in `docs/user-manual.md`.
5. Hand off with changed artifacts, exact commands run, blockers, residual risks, and the proposed tag name.

## Constraints

- Do not invent domain facts, policies, owners, dependencies, or product behavior.
- Distribution work and remote repository changes are outside this workflow unless the user separately requests them.
- Do not rewrite unrelated release history while preparing the current release.
- Treat Renma findings at or above the requested failure threshold as release blockers unless the user explicitly accepts a documented suppression.
- Redact secrets, credentials, tokens, personal data, and proprietary values from release artifacts and shared logs.
- Prefer local `node dist/index.js ...` commands for dogfooding this checkout over installed global binaries.

## Validation

- `npm test`
- `npm run build`
- `node dist/index.js scan . --fail-on high`
- `node dist/index.js catalog . --format markdown`
- `node dist/index.js readiness . --format markdown`
- `node dist/index.js graph . --focus skill.release-prep --format mermaid`
- `node dist/index.js diff . --from <latest-tag> --to HEAD --format markdown`
- `node dist/index.js ci-report . --from <latest-tag> --to HEAD --format markdown`
