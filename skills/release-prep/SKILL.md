---
name: release-prep
description: Route Renma release preparation, validation, publication, resumption, release-note generation, and GitHub Release management through the repository release workflow. Use for requests such as "release 0.23.5", "release it", "publish or ship this version", or "update the GitHub Release page". Do not use for unrelated changelog cleanup, direct npm publication, or releases outside this repository.
metadata:
  renma.id: skill.release-prep
  renma.title: Release Prep
  renma.version: "0.2.1"
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

## Hard Constraints

When relaying or translating the Context, preserve each explicit human-approval guard next to its external action. Do not weaken, move, or summarize away those guards. If a summary or translation cannot keep a guard adjacent, quote the relevant Context passage instead and stop before the external action.

Context の内容を伝達または翻訳する場合は、人による各明示的な承認ゲートを、対応する外部操作の近くに維持します。これらのゲートを弱めたり、移動したり、要約によって省略したりしません。要約または翻訳でゲートを近くに維持できない場合は、代わりに該当する Context の一節を引用し、外部操作の前で停止します。

## Completion Criteria

Finish when the Context's criteria for the requested release stage are satisfied, then return the evidence it requires.

依頼されたリリース段階について Context の基準を満たした時点で完了し、Context が求める証拠を返します。
