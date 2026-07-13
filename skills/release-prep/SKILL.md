---
name: release-prep
description: Prepare or interactively trigger a Renma release from a local checkout by checking repository history, changelog, package metadata, docs, release notes, and Renma CLI reports. Use when release-ready artifacts or validation evidence are needed, when asked to generate or display GitHub Release notes, or when explicitly asked to push validated main and version-tag refs and publish an approved GitHub Release. Delegate npm authentication and publication exclusively to GitHub Actions. Do not use for unrelated changelog cleanup, manual npm publication, or releases outside this repository.
metadata:
  renma.id: skill.release-prep
  renma.title: Release Prep
  renma.version: "0.1.0"
  renma.owner: maintainers
  renma.status: stable
  renma.tags: '["release","maintenance","dogfooding"]'
  renma.requires-context: '["context.release.prep"]'
  renma.allowed-data: '["public"]'
  renma.network-allowed: "true"
  renma.external-upload-allowed: "true"
  renma.secrets-allowed: "false"
  renma.requires-human-approval: "true"
  renma.forbidden-inputs: '["secrets","credentials","tokens"]'
---

# Release Prep

Use this skill as the entrypoint for the required `context.release.prep` workflow.

## Routing

1. Read `context.release.prep` before preparing or changing release artifacts.
2. Follow its required inputs, workflow, constraints, validation, and completion criteria.
3. For a request to generate or display GitHub Release notes, run `node tools/release-prep.mjs --release-notes --version <version>` and return its Markdown output.
4. For an explicitly requested release trigger, follow the context's interactive gates in order. Only after explicit human approval, push `origin/main`. Obtain another explicit human approval before pushing the validated version tag. After trusted publishing succeeds, present the GitHub Release body for content approval and obtain separate publication approval before creating or updating the release.
5. Use `tools/release-prep.mjs` for other operations only as directed by that context.
6. Return the release artifacts and evidence specified by the context.

## Hard Constraints

- For a release-notes-only request, return the generated Markdown and stop before finalization, commits, tags, remote pushes, package publication, or public release creation.
- Keep the package release step inside the GitHub Actions trusted-publishing workflow. Use local npm commands only for validation and read-only public registry verification.
- Treat `origin/main` and version-tag pushes as separate external writes. Show the resolved `origin` URL, source commit, and exact destination ref, and obtain a separate explicit approval immediately before each push.
- After the tag workflow succeeds, present the complete generated GitHub Release body and wait for content approval. Then show whether the release will be created or updated and obtain a separate explicit publication approval immediately before writing it to GitHub.
