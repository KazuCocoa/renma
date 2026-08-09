import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("release-prep routes broad and resumable release requests", () => {
  const skill = readFileSync("skills/release-prep/SKILL.md", "utf8");
  const context = readFileSync("contexts/release/prep.md", "utf8");

  for (const trigger of [
    "release 0.23.5",
    "release it",
    "publish or ship this version",
    "update the GitHub Release page",
  ]) {
    assert.ok(skill.includes(`"${trigger}"`), `missing trigger: ${trigger}`);
  }
  assert.match(
    skill,
    /renma\.requires-context: '\["context\.release\.prep"\]'/,
  );
  assert.match(skill, /Treat that Context as authoritative/);
  assert.match(context, /resume at the earliest incomplete step/);
  assert.match(context, /GitHub-Release-only request on an existing tag/);
  assert.match(context, /Do not require the tag to be absent/);
});

test("release-prep routes release-notes-only requests without finalization", () => {
  const skill = readFileSync("skills/release-prep/SKILL.md", "utf8");
  const context = readFileSync("contexts/release/prep.md", "utf8");

  assert.match(skill, /release-note generation/);
  assert.doesNotMatch(skill, /tools\/release-prep\.mjs/);
  assert.match(context, /--release-notes --version <version>/);
  assert.match(
    context,
    /Stop before editing release artifacts or creating commits, tags, pushes/,
  );
  assert.match(context, /For a release-notes-only request/);
  assert.match(context, /return the Markdown output directly/);
});

test("release-prep delegates npm publication to tag-triggered GitHub Actions", () => {
  const skill = readFileSync("skills/release-prep/SKILL.md", "utf8");
  const context = readFileSync("contexts/release/prep.md", "utf8");
  const workflow = readFileSync(".github/workflows/npm-publish.yml", "utf8");

  assert.match(
    context,
    /Keep the package release step inside.*trusted publishing/,
  );
  assert.match(context, /Ask for approval to push `origin\/main`/);
  assert.match(context, /push only `main:main`/);
  assert.match(context, /Ask separately for approval to push the tag/);
  assert.match(context, /push only that tag to trigger the workflow/);
  assert.match(context, /verify the version and integrity metadata/);
  assert.doesNotMatch(skill, /tools\/release-prep\.mjs/);
  assert.match(
    context,
    /title must be exactly `Renma v<version>`, including the `v` prefix/,
  );
  assert.match(context, /Do not use the bare tag itself as the release title/);
  assert.match(context, /Wait for explicit content approval/);
  assert.match(
    context,
    /ask separately for permission to write the approved content to GitHub/,
  );
  assert.match(
    context,
    /One approval does not authorize the other|separate explicit approval/,
  );
  assert.match(workflow, /tags:\n {6}- "v\*\.\*\.\*"/);
  assert.match(workflow, /Uses npm trusted publishing \(OIDC\)/);
  assert.match(workflow, /run: npm publish/);
});

test("release-prep prints GitHub release notes from the target changelog section", () => {
  const result = spawnSync(
    "node",
    ["tools/release-prep.mjs", "--release-notes", "--version", "0.6.0"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /^Renma v0\.6\.0 includes 8 changelog entries across added and changed\./,
  );
  assert.match(result.stdout, /## Highlights/);
  assert.match(result.stdout, /### Added/);
  assert.match(result.stdout, /- Added freshness diagnostics/);
  assert.match(result.stdout, /### Changed/);
  assert.match(result.stdout, /## Upgrade/);
  assert.match(result.stdout, /## Validation/);
  assert.match(
    result.stdout,
    /node dist\/index\.js diff \. --from v0\.5\.1 --to HEAD --format markdown/,
  );
});

test("release-prep preserves wrapped changelog bullets in release notes", () => {
  const result = spawnSync(
    "node",
    ["tools/release-prep.mjs", "--release-notes", "--version", "0.18.0"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /^Renma v0\.18\.0 includes 37 changelog entries across added, changed, fixed, removed, compatibility, and migration\./,
  );
  assert.match(
    result.stdout,
    /- Added the internal `renma-quality` profile family\. The emitted profile\n {2}identifier is derived from the Renma package version as\n {2}`renma-quality@<package version>`\. Added canonical threshold documentation\n {2}with units, provenance, rationale, false-positive risks, and\n {2}future-configurability status\./,
  );
  assert.match(
    result.stdout,
    /- Added BOM and Trust Graph v2 as the first supported long-term schema\n {2}contracts\. Renma 0\.18\.0 does not provide a v1 compatibility mode; the\n {2}earlier experimental v1 surface was removed before broader adoption\./,
  );

  for (const heading of [
    "## Highlights",
    "### Added",
    "### Changed",
    "### Fixed",
    "### Removed",
    "### Compatibility",
    "### Migration",
    "## Upgrade",
    "## Validation",
    "## Summary",
  ]) {
    assert.ok(result.stdout.includes(heading), `missing heading: ${heading}`);
  }
});

test("release-prep rejects stale maintained consumer pins during check-only finalization", async (t) => {
  const root = await releasePrepFixture(t, "0.31.0");
  const result = runReleasePrep(root);

  assert.equal(result.status, 1, result.stderr);
  assert.match(
    result.stdout,
    /FAIL consumer pin docs\/user-manual\.md is stale \(found renma@0\.31\.0; expected renma@0\.32\.0\)/,
  );
  assert.match(
    result.stdout,
    /FAIL consumer pin examples\/github-actions\/renma-ci-report\.yml is stale \(found renma@0\.31\.0; expected renma@0\.32\.0\)/,
  );
});

test("release-prep accepts matching exact consumer pins during check-only finalization", async (t) => {
  const root = await releasePrepFixture(t, "0.32.0");
  const result = runReleasePrep(root);

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(
    result.stdout,
    /PASS consumer pin docs\/user-manual\.md matches renma@0\.32\.0/,
  );
  assert.match(
    result.stdout,
    /PASS consumer pin examples\/github-actions\/renma-ci-report\.yml matches renma@0\.32\.0/,
  );
  assert.match(result.stdout, /PASS only release files changed/);
});

test("release-prep reports missing and ambiguous maintained consumer pins clearly", async (t) => {
  const missingRoot = await releasePrepFixture(t, undefined);
  const missing = runReleasePrep(missingRoot);
  assert.equal(missing.status, 1);
  assert.match(
    missing.stdout,
    /consumer pin docs\/user-manual\.md is missing \(expected renma@0\.32\.0\)/,
  );

  const ambiguousRoot = await releasePrepFixture(t, "0.32.0", true);
  const ambiguous = runReleasePrep(ambiguousRoot);
  assert.equal(ambiguous.status, 1);
  assert.match(
    ambiguous.stdout,
    /consumer pin docs\/user-manual\.md is ambiguous .*expected one renma@0\.32\.0/,
  );
});

function runReleasePrep(root: string) {
  return spawnSync(
    "node",
    [
      path.resolve("tools/release-prep.mjs"),
      "--check-only",
      "--finalize",
      "--version",
      "0.32.0",
      "--from",
      "v0.31.0",
    ],
    { cwd: root, encoding: "utf8" },
  );
}

async function releasePrepFixture(
  t: test.TestContext,
  pinVersion: string | undefined,
  duplicatePin = false,
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-release-prep-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "docs"), { recursive: true });
  await mkdir(path.join(root, "examples", "github-actions"), {
    recursive: true,
  });

  await writeReleaseFixtureFiles(root, "0.31.0", "0.31.0");
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "renma@example.test"]);
  git(root, ["config", "user.name", "Renma Test"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "baseline"]);
  git(root, ["tag", "v0.31.0"]);

  await writeReleaseFixtureFiles(root, "0.32.0", pinVersion, duplicatePin);
  return root;
}

async function writeReleaseFixtureFiles(
  root: string,
  packageVersion: string,
  pinVersion: string | undefined,
  duplicatePin = false,
): Promise<void> {
  await writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "renma", version: packageVersion }, null, 2)}\n`,
  );
  await writeFile(
    path.join(root, "package-lock.json"),
    `${JSON.stringify({ name: "renma", version: packageVersion }, null, 2)}\n`,
  );
  await writeFile(
    path.join(root, "CHANGELOG.md"),
    `# Changelog\n\n## [${packageVersion}]\n\n### Changed\n\n- Fixture release.\n\n[${packageVersion}]: https://github.com/KazuCocoa/renma/compare/v0.31.0...v${packageVersion}\n`,
  );

  const install =
    pinVersion === undefined
      ? "npm install --save-dev --save-exact renma"
      : `npm install --save-dev --save-exact renma@${pinVersion}`;
  await writeFile(
    path.join(root, "docs", "user-manual.md"),
    `${install}\n${duplicatePin ? `${install}\n` : ""}`,
  );
  await writeFile(
    path.join(root, "examples", "github-actions", "renma-ci-report.yml"),
    `# ${install}\n# npx --no-install renma scan . --strict\n`,
  );
}

function git(root: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}
