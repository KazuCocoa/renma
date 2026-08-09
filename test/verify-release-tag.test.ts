import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const FIXTURE_PACKAGE_VERSION = "9.8.7";
const VERIFY_SCRIPT = path.resolve("tools/verify-release-tag.mjs");

test("release-tag verifier accepts an annotated tag at exact origin/main", async (t) => {
  const fixture = await releaseTagFixture(t, {
    annotated: true,
    position: "exact",
    tagVersion: FIXTURE_PACKAGE_VERSION,
  });

  const result = runVerifier(fixture.checkout, fixture.tag);

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /is annotated, targets the exact origin\/main commit, and matches package\.json version 9\.8\.7/,
  );
});

test("release-tag verifier rejects a lightweight tag", async (t) => {
  const fixture = await releaseTagFixture(t, {
    annotated: false,
    position: "exact",
    tagVersion: FIXTURE_PACKAGE_VERSION,
  });

  const result = runVerifier(fixture.checkout, fixture.tag);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /is missing or is not an annotated tag/);
});

test("release-tag verifier rejects annotated tags that are not exact origin/main", async (t) => {
  for (const position of ["ahead", "behind", "beside"] as const) {
    await t.test(position, async (t) => {
      const fixture = await releaseTagFixture(t, {
        annotated: true,
        position,
        tagVersion: FIXTURE_PACKAGE_VERSION,
      });

      const result = runVerifier(fixture.checkout, fixture.tag);

      assert.equal(result.status, 1);
      assert.match(
        result.stderr,
        /does not target the exact origin\/main commit/,
      );
      assert.doesNotMatch(
        result.stderr,
        /does not match package\.json version/,
      );
    });
  }
});

test("a matching tag and package version on a non-main commit still fails", async (t) => {
  const fixture = await releaseTagFixture(t, {
    annotated: true,
    position: "ahead",
    tagVersion: FIXTURE_PACKAGE_VERSION,
  });

  const result = runVerifier(fixture.checkout, fixture.tag);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not target the exact origin\/main commit/);
  assert.doesNotMatch(result.stderr, /version .* does not match/);
});

test("release-tag verifier rejects a tag/package version mismatch", async (t) => {
  const fixture = await releaseTagFixture(t, {
    annotated: true,
    position: "exact",
    tagVersion: "9.8.8",
  });

  const result = runVerifier(fixture.checkout, fixture.tag);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /Release tag version 9\.8\.8 does not match package\.json version 9\.8\.7/,
  );
});

test("release-tag verifier binds the fetched remote tag to the workflow checkout", async (t) => {
  const fixture = await releaseTagFixture(t, {
    annotated: true,
    moveRemoteTagToMainAfterClone: true,
    position: "ahead",
    tagVersion: FIXTURE_PACKAGE_VERSION,
  });

  const result = runVerifier(fixture.checkout, fixture.tag);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not match the checked-out workflow commit/);
});

type TagPosition = "exact" | "ahead" | "behind" | "beside";

async function releaseTagFixture(
  t: test.TestContext,
  input: {
    annotated: boolean;
    moveRemoteTagToMainAfterClone?: boolean;
    position: TagPosition;
    tagVersion: string;
  },
): Promise<{ checkout: string; tag: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-release-tag-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const source = path.join(root, "source");
  const remote = path.join(root, "origin.git");
  const checkout = path.join(root, "checkout");
  await mkdir(source);
  await mkdir(remote);

  git(remote, ["init", "--bare", "-q"]);
  git(source, ["init", "-q", "-b", "main"]);
  git(source, ["config", "user.email", "renma@example.test"]);
  git(source, ["config", "user.name", "Renma Test"]);
  await writeFile(
    path.join(source, "package.json"),
    `${JSON.stringify({ name: "renma", version: FIXTURE_PACKAGE_VERSION }, null, 2)}\n`,
  );
  git(source, ["add", "package.json"]);
  git(source, ["commit", "-qm", "base"]);
  const baseCommit = gitOutput(source, ["rev-parse", "HEAD"]);

  git(source, ["commit", "--allow-empty", "-qm", "reviewed main"]);
  const mainCommit = gitOutput(source, ["rev-parse", "HEAD"]);
  git(source, ["remote", "add", "origin", remote]);
  git(source, ["push", "-q", "origin", "main:main"]);

  let tagCommit = mainCommit;
  if (input.position === "behind") {
    tagCommit = baseCommit;
  } else if (input.position === "ahead") {
    git(source, ["commit", "--allow-empty", "-qm", "unreviewed ahead"]);
    tagCommit = gitOutput(source, ["rev-parse", "HEAD"]);
  } else if (input.position === "beside") {
    git(source, ["checkout", "-q", "-b", "side", baseCommit]);
    git(source, ["commit", "--allow-empty", "-qm", "unreviewed beside"]);
    tagCommit = gitOutput(source, ["rev-parse", "HEAD"]);
  }

  const tag = `v${input.tagVersion}`;
  const tagArgs = input.annotated
    ? ["tag", "-a", tag, "-m", "fixture release", tagCommit]
    : ["tag", tag, tagCommit];
  git(source, tagArgs);
  git(source, ["push", "-q", "origin", `refs/tags/${tag}`]);

  git(root, [
    "clone",
    "-q",
    "--depth",
    "1",
    "--branch",
    tag,
    pathToFileURL(remote).href,
    checkout,
  ]);
  assert.equal(
    gitOutput(checkout, ["rev-parse", "--is-shallow-repository"]),
    "true",
  );

  if (input.moveRemoteTagToMainAfterClone) {
    git(source, ["tag", "-f", "-a", tag, "-m", "moved tag", mainCommit]);
    git(source, ["push", "-q", "--force", "origin", `refs/tags/${tag}`]);
  }

  return { checkout, tag };
}

function runVerifier(root: string, tag: string) {
  return spawnSync("node", [VERIFY_SCRIPT], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GITHUB_REF_NAME: tag },
  });
}

function git(root: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function gitOutput(root: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
