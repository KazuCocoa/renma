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

## Language policy for this Context

### Hard Constraints

The English sections in this Context are authoritative instructions for LLM execution.
Japanese text immediately following English text is a non-authoritative aid for human readers.
Resolve any discrepancy in favor of the English instruction.
The translation does not introduce requirements beyond its English source.
Determine workflow requirements from the English sections.

この Context では、英語の各セクションが LLM 実行用の正式な指示です。
英語の直後にある日本語は、人が読みやすくするための非正式な補助訳です。
内容に相違がある場合は、英語の指示を優先してください。
日本語訳は、対応する英語の原文にない要件を追加するものではありません。
ワークフローの要件は英語の各セクションから判断してください。

## Summary

Renma release preparation is local-first and evidence-based. Use `tools/release-prep.mjs` for deterministic metadata checks, GitHub-ready release notes, Renma dogfooding reports, validation commands, and optional npm-version-style local commit/tag finalization.

Renma のリリース準備は、ローカルでの作業と証拠に基づく確認を優先します。決定的なメタデータチェック、GitHub 向けリリースノート、Renma のドッグフーディングレポート、検証コマンド、および任意の npm version 形式のローカルコミット・タグ確定には、`tools/release-prep.mjs` を使用します。

GitHub Actions owns the package release step. Each external write occurs only after explicit human approval for its exact destination and ref or release operation. The gates cover `origin/main`, the version tag, and the final GitHub Release separately.

パッケージのリリース手順は GitHub Actions が担当します。外部への各書き込みは、正確な宛先と ref、またはリリース操作について、人による明示的な承認を得た後にのみ行います。承認ゲートは、`origin/main`、バージョンタグ、最終的な GitHub Release のそれぞれに個別に適用します。

## Scope

This context applies when:

このコンテキストは、次の場合に適用します。

- Preparing a new Renma release from a local checkout.
- ローカルチェックアウトから新しい Renma リリースを準備する場合。
- Reconciling `CHANGELOG.md`, `package.json`, `package-lock.json`, docs, and release notes for a target version.
- 対象バージョンについて、`CHANGELOG.md`、`package.json`、`package-lock.json`、ドキュメント、およびリリースノートの整合性を取る場合。
- Generating or displaying GitHub-ready release notes from an existing changelog section.
- 既存の changelog セクションから GitHub 向けリリースノートを生成または表示する場合。
- Producing release evidence for review or CI.
- レビューまたは CI のためのリリース証拠を作成する場合。
- Interactively pushing validated `origin/main` and version-tag refs, then creating or updating an approved GitHub Release.
- 検証済みの `origin/main` とバージョンタグの ref を対話的にリモートへ送信し、承認済みの GitHub Release を作成または更新する場合。

This context does not apply when:

このコンテキストは、次の場合には適用しません。

- Direct npm authentication or publication.
- npm の認証または公開を直接行う場合。
- Updating unrelated historical release notes.
- 無関係な過去のリリースノートを更新する場合。
- Making general documentation edits outside a release-prep workflow.
- リリース準備ワークフロー外で一般的なドキュメント編集を行う場合。

## Release Inputs

- Target version or intended semantic-version increment.
- 対象バージョン、または予定するセマンティックバージョンの増分。
- Base ref for release comparison, selected from repository history.
- リポジトリ履歴から選択した、リリース比較用のベース ref。
- Any known release theme, blockers, or user-facing changes.
- 判明しているリリーステーマ、ブロッカー、またはユーザー向けの変更。

## Workflow

For a release-notes-only request, run `node tools/release-prep.mjs --release-notes --version <version>`, add `--from <tag>` or `--to <ref>` when needed, and return the Markdown output directly. Stop before editing release artifacts or creating commits, tags, pushes, packages, or public releases unless separately requested.

リリースノートのみのリクエストでは、`node tools/release-prep.mjs --release-notes --version <version>` を実行し、必要に応じて `--from <tag>` または `--to <ref>` を追加して、Markdown 出力をそのまま返します。別途依頼されない限り、リリース成果物の編集、コミット、タグ、リモートへの送信、パッケージ、または公開リリースの作成前に停止します。

For full release preparation:

完全なリリース準備では、次の手順を実行します。

1. Inspect `package.json`, `package-lock.json`, `CHANGELOG.md`, and release-relevant docs.
   - `package.json`、`package-lock.json`、`CHANGELOG.md`、およびリリースに関係するドキュメントを確認します。
2. Run `node tools/release-prep.mjs --check-only` to check version, changelog, and base-tag consistency.
   - `node tools/release-prep.mjs --check-only` を実行し、バージョン、changelog、およびベースタグの整合性を確認します。
3. Edit release artifacts: version fields, changelog section/links, release notes, and docs affected by changed commands or diagnostics.
   - バージョンフィールド、changelog のセクションとリンク、リリースノート、および変更されたコマンドや診断の影響を受けるドキュメントを編集します。
4. Run `node tools/release-prep.mjs --release-notes --version <version>` to generate the GitHub Release body from `CHANGELOG.md`. Add `--from <tag>` or `--to <ref>` when generating notes for an older tag or a non-default comparison range.
   - `node tools/release-prep.mjs --release-notes --version <version>` を実行し、`CHANGELOG.md` から GitHub Release の本文を生成します。過去のタグまたはデフォルト以外の比較範囲からノートを生成する場合は、`--from <tag>` または `--to <ref>` を追加します。
5. Run `node tools/release-prep.mjs` to execute tests, build, Renma scan/catalog/readiness/graph, diff, and CI report.
   - `node tools/release-prep.mjs` を実行し、テスト、ビルド、Renma の scan、catalog、readiness、graph、diff、および CI report を実行します。
6. When requested, run `node tools/release-prep.mjs --finalize` to stage only intended release files and create the local version commit and annotated tag.
   - 依頼された場合は、`node tools/release-prep.mjs --finalize` を実行し、意図したリリースファイルだけをステージして、ローカルのバージョンコミットと注釈付きタグを作成します。
7. Hand off changed artifacts, generated release notes, validation results, blockers, residual risks, commit hash, and tag name.
   - 変更した成果物、生成したリリースノート、検証結果、ブロッカー、残存リスク、コミットハッシュ、およびタグ名を引き継ぎます。

For an explicitly requested release trigger:

明示的にリリースの実行を求められた場合は、次の手順を実行します。

1. Confirm the worktree is clean, the checked-out branch is `main`, the release commit is a fast-forward candidate for `origin/main`, the version matches `package.json`, and the version tag is absent locally and remotely.
   - ワークツリーがクリーンであること、チェックアウト中のブランチが `main` であること、リリースコミットが `origin/main` に fast-forward 可能であること、バージョンが `package.json` と一致すること、およびバージョンタグがローカルとリモートの両方に存在しないことを確認します。
2. If the exact release state is already committed, do not create an empty release commit. If release files still need finalization, use `--finalize` and inspect the resulting commit before any push.
   - 正確なリリース状態がすでにコミットされている場合、空のリリースコミットは作成しません。リリースファイルを確定する必要がある場合は、`--finalize` を使用し、リモートへ送信する前に生成されたコミットを確認します。
3. Resolve and show the exact `origin` URL, local `main` commit, remote `main` commit, and `main:main` refspec. Ask for approval to push `origin/main`; after approval, push only `main:main` and verify the remote ref points to the validated release commit.
   - 正確な `origin` URL、ローカルの `main` コミット、リモートの `main` コミット、および `main:main` refspec を解決して提示します。`origin/main` をリモートへ送信する承認を求め、承認後は `main:main` だけを送信し、リモート ref が検証済みのリリースコミットを指していることを確認します。
4. Create or validate the annotated `v<version>` tag at that same commit. Confirm `.github/workflows/npm-publish.yml` still triggers on `v*.*.*` tag pushes and uses npm trusted publishing.
   - 同じコミットに注釈付きの `v<version>` タグを作成または検証します。`.github/workflows/npm-publish.yml` が引き続き `v*.*.*` タグのリモート送信で起動し、npm trusted publishing を使用することを確認します。
5. Show the exact `origin` URL, tag, and target commit. Ask separately for approval to push the tag; after approval, push only that tag to trigger the workflow.
   - 正確な `origin` URL、タグ、および対象コミットを提示します。タグをリモートへ送信する承認を別途求め、承認後はそのタグだけを送信してワークフローを起動します。
6. Monitor the triggered workflow through completion. Treat a failed test, build, package check, tag/version check, or publish step as a release blocker.
   - 起動したワークフローを完了まで監視します。テスト、ビルド、パッケージチェック、タグとバージョンのチェック、または公開手順の失敗をリリースブロッカーとして扱います。
7. After workflow success, verify the version and integrity metadata from the public npm registry. Use read-only registry queries only.
   - ワークフローの成功後、公開 npm レジストリからバージョンと整合性メタデータを検証します。読み取り専用のレジストリクエリだけを使用します。
8. Generate and present the complete GitHub Release title and body to the user. Wait for explicit content approval and incorporate requested edits before continuing.
   - GitHub Release の完全なタイトルと本文を生成してユーザーに提示します。明示的な内容承認を待ち、要求された修正を反映してから続行します。
9. Determine whether the tag's GitHub Release will be created or updated. Show the repository, tag, title, and operation, then ask separately for permission to write the approved content to GitHub. Only after that publication approval, create or update the GitHub Release and verify its URL and published content.
   - タグの GitHub Release が作成されるか更新されるかを判断します。リポジトリ、タグ、タイトル、および操作を提示し、承認済みの内容を GitHub に書き込む許可を別途求めます。その公開承認を得た後にのみ、GitHub Release を作成または更新し、その URL と公開内容を検証します。
10. Return the workflow URL, branch and tag commits, registry evidence, GitHub Release URL, and any residual blockers.
    - ワークフロー URL、ブランチとタグのコミット、レジストリの証拠、GitHub Release の URL、および残っているブロッカーを返します。

## Constraints

- Do not invent domain facts, policies, owners, dependencies, or product behavior.
- ドメインの事実、ポリシー、所有者、依存関係、または製品動作を捏造しません。
- Keep the package release step inside `.github/workflows/npm-publish.yml` through trusted publishing. Use local npm commands only for validation and read-only public registry verification.
- パッケージのリリース手順は、trusted publishing を使用する `.github/workflows/npm-publish.yml` 内に維持します。ローカルの npm コマンドは、検証および公開レジストリの読み取り専用確認にのみ使用します。
- `origin/main` and version-tag pushes require separate, immediate approvals. One approval does not authorize the other or any later GitHub Release write.
- `origin/main` とバージョンタグのリモート送信には、それぞれ個別かつ直前の承認が必要です。一方の承認は、もう一方の操作や、その後の GitHub Release への書き込みを許可するものではありません。
- GitHub Release content approval confirms the text only. Obtain an additional, immediate publication approval for the resolved repository, tag, and create-or-update operation before writing to GitHub.
- GitHub Release の内容承認は、テキストだけを確認するものです。GitHub に書き込む前に、解決済みのリポジトリ、タグ、および作成または更新操作について、追加の直前公開承認を得ます。
- Local version commits and local annotated tags are allowed when the user asks for release finalization.
- ユーザーがリリースの確定を求めた場合、ローカルのバージョンコミットと注釈付きタグの作成は許可されます。
- Do not rewrite unrelated release history while preparing the current release.
- 現在のリリースを準備する際に、無関係なリリース履歴を書き換えません。
- Treat Renma findings at or above the requested failure threshold as release blockers unless the user explicitly accepts a documented suppression.
- ユーザーが文書化された抑制を明示的に受け入れない限り、要求された失敗しきい値以上の Renma finding をリリースブロッカーとして扱います。
- Redact secrets, credentials, tokens, personal data, and proprietary values from release artifacts and shared logs.
- リリース成果物と共有ログから、シークレット、認証情報、トークン、個人データ、およびプロプライエタリな値を削除またはマスキングします。
- Prefer local `node dist/index.js ...` commands for dogfooding this checkout over installed global binaries.
- このチェックアウトをドッグフーディングする際は、インストール済みのグローバルバイナリよりも、ローカルの `node dist/index.js ...` コマンドを優先します。

## Validation

Run `node tools/release-prep.mjs`; use `--check-only` for metadata checks only, `--release-notes` for GitHub Release body generation, and `--finalize` for local commit/tag creation after validation.

`node tools/release-prep.mjs` を実行します。メタデータチェックだけを行う場合は `--check-only`、GitHub Release の本文を生成する場合は `--release-notes`、検証後にローカルのコミットとタグを作成する場合は `--finalize` を使用します。

## Completion Criteria

- Release metadata, changelog, docs, and release notes are consistent for the target version.
- リリースメタデータ、changelog、ドキュメント、およびリリースノートが対象バージョンについて整合しています。
- GitHub-ready release notes are generated from `CHANGELOG.md` and the intended comparison range, and displayed directly when that is the user's request.
- GitHub 向けリリースノートが `CHANGELOG.md` と意図した比較範囲から生成され、ユーザーが求めた場合はそのまま表示されています。
- Required Renma reports have been run, or any skipped report is explained.
- 必須の Renma レポートが実行されているか、スキップしたレポートについて説明されています。
- The final handoff names blockers, residual risks, and the local commit and tag state.
- 最終的な引き継ぎに、ブロッカー、残存リスク、およびローカルのコミットとタグの状態が記載されています。
- Completion evidence for a requested release trigger includes matching remote branch and tag commits, a successful GitHub Actions run, verified npm metadata, and the verified URL and body of the separately approved GitHub Release.
- 要求されたリリース実行の完了証拠に、一致するリモートブランチとタグのコミット、成功した GitHub Actions の実行、検証済みの npm メタデータ、および別途承認された GitHub Release の検証済み URL と本文が含まれています。
