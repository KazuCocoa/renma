---
name: release-prep
description: Route Renma release preparation, validation, publication, resumption, release-note generation, and GitHub Release management through the repository release workflow. Use for requests such as "release 0.23.5", "release it", "publish or ship this version", or "update the GitHub Release page". Do not use for unrelated changelog cleanup, direct npm publication, or releases outside this repository.
metadata:
  renma.id: skill.release-prep
  renma.title: Release Prep
  renma.version: "0.2.0"
  renma.owner: maintainers
  renma.status: stable
  renma.tags: '["release","maintenance","dogfooding"]'
  renma.requires-context: '["context.release.prep"]'
  renma.allowed-data: '["public"]'
  renma.network-allowed: "true"
  renma.approved-network-destinations: '["github.com","api.github.com","registry.npmjs.org"]'
  renma.external-upload-allowed: "true"
  renma.approved-upload-destinations: '["github.com","api.github.com"]'
  renma.secrets-allowed: "false"
  renma.requires-human-approval: "true"
  renma.forbidden-inputs: '["secrets","credentials","tokens"]'
  renma.published-entrypoint: "true"
---

# Release Prep

## Routing

Apply the required `context.release.prep` to the release stage requested by the user. Treat that Context as authoritative for release commands, approval gates, constraints, validation, and completion evidence.

必須の `context.release.prep` を、ユーザーが依頼したリリース段階に適用します。リリース用コマンド、承認ゲート、制約、検証、および完了証拠については、この Context を正式な情報源として扱います。

## Completion Criteria

Finish when the Context's criteria for the requested release stage are satisfied, then return the evidence it requires.

依頼されたリリース段階について Context の基準を満たした時点で完了し、Context が求める証拠を返します。
