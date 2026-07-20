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
2. Follow its required inputs, workflow, constraints, validation, and completion criteria.
   - そこに記載された必須入力、ワークフロー、制約、検証、および完了基準に従います。
3. For a request to generate or display GitHub Release notes, run `node tools/release-prep.mjs --release-notes --version <version>` and return its Markdown output.
   - GitHub Release ノートの生成または表示を求められた場合は、`node tools/release-prep.mjs --release-notes --version <version>` を実行し、その Markdown 出力を返します。
4. For an explicitly requested release trigger, follow the context's interactive gates in order. Only after explicit human approval, push `origin/main`. Obtain another explicit human approval before pushing the validated version tag. After trusted publishing succeeds, present the GitHub Release body for content approval and obtain separate publication approval before creating or updating the release.
   - 明示的にリリースの実行を求められた場合は、コンテキストの対話式ゲートに順番どおり従います。人による明示的な承認を得た後に限り（Only after explicit human approval）、`origin/main` を push します。検証済みのバージョンタグ（validated version tag）を push する前に、改めて人による明示的な承認（explicit human approval）を得ます。trusted publishing が成功した後、内容の承認（content approval）を得るために GitHub Release の本文を提示し、リリースを作成または更新する前に別途公開の承認（publication approval）を得ます。
5. Use `tools/release-prep.mjs` for other operations only as directed by that context.
   - その他の操作には、当該コンテキストで指示された場合に限り `tools/release-prep.mjs` を使用します。
6. Return the release artifacts and evidence specified by the context.
   - コンテキストで指定されたリリース成果物とエビデンスを返します。

## Hard Constraints

- For a release-notes-only request, return the generated Markdown and stop before finalization, commits, tags, remote pushes, package publication, or public release creation.
- リリースノートのみのリクエストでは、生成された Markdown を返し、最終確定、コミット、タグ、リモートへの push、パッケージの公開、または公開リリースの作成の前に停止します。
- Keep the package release step inside the GitHub Actions trusted-publishing workflow. Use local npm commands only for validation and read-only public registry verification.
- パッケージのリリース手順は GitHub Actions の trusted-publishing ワークフロー内で実行します。ローカルの npm コマンドは、検証および公開レジストリの読み取り専用確認に限定して使用します。
- Treat `origin/main` and version-tag pushes as separate external writes. Show the resolved `origin` URL, source commit, and exact destination ref, and obtain a separate explicit approval immediately before each push.
- `origin/main` の push とバージョンタグ（version-tag）の push を、別々の外部書き込みとして扱います。解決された `origin` URL、ソースコミット（source commit）、および正確な宛先 ref（destination ref）を示し、各 push の直前に個別の明示的な承認（explicit approval）を得ます。
- After the tag workflow succeeds, present the complete generated GitHub Release body and wait for content approval. Then show whether the release will be created or updated and obtain a separate explicit publication approval immediately before writing it to GitHub.
- タグのワークフローが成功した後、生成された GitHub Release の本文全体を提示し、内容の承認（content approval）を待ちます。次に、リリースが作成されるか更新されるかを示し、GitHub に書き込む直前に個別の明示的な公開承認（explicit publication approval）を得ます。
