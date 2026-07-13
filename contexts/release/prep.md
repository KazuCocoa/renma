---
id: context.release.prep
title: Release Prep Workflow
version: 0.1.0
owner: maintainers
status: stable
tags:
  - release
  - maintenance
  - dogfooding
when_to_use:
  - Preparing a Renma release from a local checkout
when_not_to_use:
  - Publishing packages directly outside the repository GitHub Actions workflow
allowed_data: public
network_allowed: true
external_upload_allowed: true
secrets_allowed: false
requires_human_approval: true
forbidden_inputs:
  - secrets
  - credentials
  - tokens
---

# Release Prep Workflow

## Summary

Renma release preparation is local-first and evidence-based. Use `tools/release-prep.mjs` for deterministic metadata checks, GitHub-ready release notes, Renma dogfooding reports, validation commands, and optional npm-version-style local commit/tag finalization.

GitHub Actions owns the package release step. Each external write occurs only after explicit human approval for its exact destination and ref or release operation. The gates cover `origin/main`, the version tag, and the final GitHub Release separately.

## Scope

This context applies when:

- Preparing a new Renma release from a local checkout.
- Reconciling `CHANGELOG.md`, `package.json`, `package-lock.json`, docs, and release notes for a target version.
- Generating or displaying GitHub-ready release notes from an existing changelog section.
- Producing release evidence for review or CI.
- Interactively pushing validated `origin/main` and version-tag refs, then creating or updating an approved GitHub Release.

This context does not apply when:

- Direct npm authentication or publication.
- Updating unrelated historical release notes.
- Making general documentation edits outside a release-prep workflow.

## Release Inputs

- Target version or intended semantic-version increment.
- Base ref for release comparison, selected from repository history.
- Any known release theme, blockers, or user-facing changes.

## Workflow

For a release-notes-only request, run `node tools/release-prep.mjs --release-notes --version <version>`, add `--from <tag>` or `--to <ref>` when needed, and return the Markdown output directly. Stop before editing release artifacts or creating commits, tags, pushes, packages, or public releases unless separately requested.

For full release preparation:

1. Inspect `package.json`, `package-lock.json`, `CHANGELOG.md`, and release-relevant docs.
2. Run `node tools/release-prep.mjs --check-only` to check version, changelog, and base-tag consistency.
3. Edit release artifacts: version fields, changelog section/links, release notes, and docs affected by changed commands or diagnostics.
4. Run `node tools/release-prep.mjs --release-notes --version <version>` to generate the GitHub Release body from `CHANGELOG.md`. Add `--from <tag>` or `--to <ref>` when generating notes for an older tag or a non-default comparison range.
5. Run `node tools/release-prep.mjs` to execute tests, build, Renma scan/catalog/readiness/graph, diff, and CI report.
6. When requested, run `node tools/release-prep.mjs --finalize` to stage only intended release files and create the local version commit and annotated tag.
7. Hand off changed artifacts, generated release notes, validation results, blockers, residual risks, commit hash, and tag name.

For an explicitly requested release trigger:

1. Confirm the worktree is clean, the checked-out branch is `main`, the release commit is a fast-forward candidate for `origin/main`, the version matches `package.json`, and the version tag is absent locally and remotely.
2. If the exact release state is already committed, do not create an empty release commit. If release files still need finalization, use `--finalize` and inspect the resulting commit before any push.
3. Resolve and show the exact `origin` URL, local `main` commit, remote `main` commit, and `main:main` refspec. Ask for approval to push `origin/main`; after approval, push only `main:main` and verify the remote ref points to the validated release commit.
4. Create or validate the annotated `v<version>` tag at that same commit. Confirm `.github/workflows/npm-publish.yml` still triggers on `v*.*.*` tag pushes and uses npm trusted publishing.
5. Show the exact `origin` URL, tag, and target commit. Ask separately for approval to push the tag; after approval, push only that tag to trigger the workflow.
6. Monitor the triggered workflow through completion. Treat a failed test, build, package check, tag/version check, or publish step as a release blocker.
7. After workflow success, verify the version and integrity metadata from the public npm registry. Use read-only registry queries only.
8. Generate and present the complete GitHub Release title and body to the user. Wait for explicit content approval and incorporate requested edits before continuing.
9. Determine whether the tag's GitHub Release will be created or updated. Show the repository, tag, title, and operation, then ask separately for permission to write the approved content to GitHub. Only after that publication approval, create or update the GitHub Release and verify its URL and published content.
10. Return the workflow URL, branch and tag commits, registry evidence, GitHub Release URL, and any residual blockers.

## Constraints

- Do not invent domain facts, policies, owners, dependencies, or product behavior.
- Keep the package release step inside `.github/workflows/npm-publish.yml` through trusted publishing. Use local npm commands only for validation and read-only public registry verification.
- `origin/main` and version-tag pushes require separate, immediate approvals. One approval does not authorize the other or any later GitHub Release write.
- GitHub Release content approval confirms the text only. Obtain an additional, immediate publication approval for the resolved repository, tag, and create-or-update operation before writing to GitHub.
- Local version commits and local annotated tags are allowed when the user asks for release finalization.
- Do not rewrite unrelated release history while preparing the current release.
- Treat Renma findings at or above the requested failure threshold as release blockers unless the user explicitly accepts a documented suppression.
- Redact secrets, credentials, tokens, personal data, and proprietary values from release artifacts and shared logs.
- Prefer local `node dist/index.js ...` commands for dogfooding this checkout over installed global binaries.

## Validation

Run `node tools/release-prep.mjs`; use `--check-only` for metadata checks only, `--release-notes` for GitHub Release body generation, and `--finalize` for local commit/tag creation after validation.

## Completion Criteria

- Release metadata, changelog, docs, and release notes are consistent for the target version.
- GitHub-ready release notes are generated from `CHANGELOG.md` and the intended comparison range, and displayed directly when that is the user's request.
- Required Renma reports have been run, or any skipped report is explained.
- The final handoff names blockers, residual risks, and the local commit and tag state.
- Completion evidence for a requested release trigger includes matching remote branch and tag commits, a successful GitHub Actions run, verified npm metadata, and the verified URL and body of the separately approved GitHub Release.
