import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

test("release-prep routes release-notes-only requests without finalization", () => {
  const skill = readFileSync("skills/release-prep/SKILL.md", "utf8");
  const context = readFileSync("contexts/release/prep.md", "utf8");

  assert.match(skill, /generate or display GitHub Release notes/);
  assert.match(skill, /--release-notes --version <version>/);
  assert.match(
    skill,
    /stop before finalization, commits, tags, remote pushes/i,
  );
  assert.match(context, /For a release-notes-only request/);
  assert.match(context, /return the Markdown output directly/);
});

test("release-prep delegates npm publication to tag-triggered GitHub Actions", () => {
  const skill = readFileSync("skills/release-prep/SKILL.md", "utf8");
  const context = readFileSync("contexts/release/prep.md", "utf8");
  const workflow = readFileSync(".github/workflows/npm-publish.yml", "utf8");

  assert.match(skill, /GitHub Actions trusted-publishing workflow/);
  assert.match(
    skill,
    /Keep the package release step inside.*trusted-publishing workflow/,
  );
  assert.match(context, /Ask for approval to push `origin\/main`/);
  assert.match(context, /push only `main:main`/);
  assert.match(context, /Ask separately for approval to push the tag/);
  assert.match(context, /push only that tag to trigger the workflow/);
  assert.match(context, /verify the version and integrity metadata/);
  assert.match(skill, /Use exactly `Renma v<version>`/);
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
    skill,
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
