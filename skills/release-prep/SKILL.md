---
name: release-prep
description: Prepare, validate, publish, resume, or manage a Renma release from a local checkout. Use for any Renma release request, including terse requests such as "release 0.23.5", "release it", "publish or ship this version", or "update the GitHub Release page"; for release-ready artifacts or validation evidence; for release notes; for main or version-tag pushes; for trusted npm publishing verification; and for creating or updating a GitHub Release. Resume from already verified release stages instead of repeating them. Delegate npm authentication and publication exclusively to GitHub Actions. Do not use for unrelated changelog cleanup, manual npm publication, or releases outside this repository.
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

Use this skill as the entrypoint for the required `context.release.prep` workflow.

このスキルを、必須の `context.release.prep` ワークフローへのエントリポイントとして使用します。

## Language policy

### Hard Constraints

English text is authoritative and intended for LLM execution.
Japanese text is a non-authoritative translation provided for human readability.
If the English and Japanese text differ, follow the English text only.
Do not infer additional requirements from the Japanese translation.
Use the English text instead when determining requirements.

英語のテキストが正式な内容であり、LLM の実行を目的としています。
日本語のテキストは、人が読みやすいように付記された非正式の翻訳です。
英語と日本語のテキストに相違がある場合は、英語のテキストのみに従ってください。
日本語訳から追加の要件を推測しないでください。
要件を判断するときは、代わりに英語のテキストを使用してください。

## Routing

1. Read `context.release.prep` before preparing or changing release artifacts.
   - リリース成果物を準備または変更する前に、`context.release.prep` を読みます。
2. Treat any request whose primary intent is to release, publish, or ship this repository as a release request, whether or not the user says "release prep." This includes terse requests such as `release 0.23.5`, `release it`, `publish this version`, and `update the GitHub Release page`. This classification selects the workflow only; obtain the Context's explicit human approval immediately before every external write.
   - ユーザーが「release prep」と言わない場合でも、このリポジトリのリリース、公開、または出荷が主目的の依頼はすべてリリース依頼として扱います。これには、`release 0.23.5`、`release it`、`publish this version`、`update the GitHub Release page` のような短い依頼も含まれます。この分類はワークフローを選択するだけです。外部への書き込みの直前には、Context が定める人による明示的な承認を得ます。Obtain explicit human approval immediately before every external write.
3. Inspect the current release state, accept completed pushes, package publication, and GitHub Release writes as evidence, and resume at the earliest incomplete stage.
   - 現在のリリース状態を確認し、完了済みステージを証拠として受け入れ、最初の未完了ステージから再開します。
4. Follow the Context's required inputs, workflow, constraints, validation, and completion criteria for the selected stage.
   - そこに記載された必須入力、ワークフロー、制約、検証、および完了基準に従います。
5. For a request to generate or display GitHub Release notes, run `node tools/release-prep.mjs --release-notes --version <version>` and return its Markdown output.
   - GitHub Release ノートの生成または表示を求められた場合は、`node tools/release-prep.mjs --release-notes --version <version>` を実行し、その Markdown 出力を返します。
6. For a request to create or update only the GitHub Release for an existing tag, verify the tag, successful trusted publication, and public npm metadata; then preserve the existing branch and tag refs and start at the Context's GitHub Release content and publication gates.
   - 既存タグの GitHub Release の作成または更新だけを求められた場合は、タグ、trusted publishing の成功、および公開 npm メタデータを確認します。その後、既存のブランチとタグの ref を維持し、Context の GitHub Release 内容承認および公開承認ゲートから開始します。
7. For a request to complete a release, follow the Context's remaining interactive gates in order. Only after explicit human approval, push `origin/main`. Obtain another explicit human approval before pushing the validated version tag. After trusted publishing succeeds, present the GitHub Release title `Renma v<version>` and body for content approval and obtain separate publication approval before creating or updating the release.
   - リリースの完了を求められた場合は、Context の残りの対話式ゲートに順番どおり従います。人による明示的な承認を得た後に限り（Only after explicit human approval）、`origin/main` を push します。検証済みのバージョンタグ（validated version tag）を push する前に、改めて人による明示的な承認（explicit human approval）を得ます。trusted publishing が成功した後、内容の承認（content approval）のために GitHub Release のタイトル `Renma v<version>` と本文を提示し、リリースを作成または更新する前に別途公開の承認（publication approval）を得ます。
8. Use `tools/release-prep.mjs` for other operations only as directed by that context.
   - その他の操作には、当該コンテキストで指示された場合に限り `tools/release-prep.mjs` を使用します。
9. Return the release artifacts and evidence specified by the context.
   - コンテキストで指定されたリリース成果物とエビデンスを返します。

## Hard Constraints

- Treat verified completed stages as immutable release evidence.
- Continue at the earliest incomplete stage while preserving that evidence.
- 検証済みの完了ステージを変更しないリリース証拠として扱います。
- その証拠を維持しながら、最初の未完了ステージから続行します。
- For a release-notes-only request, return the generated Markdown and stop before finalization, commits, tags, remote pushes, package publication, or public release creation.
- リリースノートのみのリクエストでは、生成された Markdown を返し、最終確定、コミット、タグ、リモートへの push、パッケージの公開、または公開リリースの作成の前に停止します。
- Keep the package release step inside the GitHub Actions trusted-publishing workflow. Use local npm commands only for validation and read-only public registry verification.
- パッケージのリリース手順は GitHub Actions の trusted-publishing ワークフロー内で実行します。ローカルの npm コマンドは、検証および公開レジストリの読み取り専用確認に限定して使用します。
- Treat `origin/main` and version-tag pushes as separate external writes. Show the resolved `origin` URL, source commit, and exact destination ref, and obtain a separate explicit approval immediately before each push.
- `origin/main` の push とバージョンタグ（version-tag）の push を、別々の外部書き込みとして扱います。解決された `origin` URL、ソースコミット（source commit）、および正確な宛先 ref（destination ref）を示し、各 push の直前に個別の明示的な承認（explicit approval）を得ます。
- Use exactly `Renma v<version>` for the GitHub Release title. Keep the Git tag as `v<version>`.
- GitHub Release のタイトルには、正確に `Renma v<version>` を使用します。Git タグは `v<version>` のままにします。
- After the tag workflow succeeds, present the complete GitHub Release title and generated body and wait for content approval. Then show whether the release will be created or updated and obtain a separate explicit publication approval immediately before writing it to GitHub.
- タグのワークフローが成功した後、GitHub Release の完全なタイトルと生成された本文を提示し、内容の承認（content approval）を待ちます。次に、リリースが作成されるか更新されるかを示し、GitHub に書き込む直前に個別の明示的な公開承認（explicit publication approval）を得ます。
