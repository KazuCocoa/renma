#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const DEFAULT_REMOTE = "origin";
const MAIN_BRANCH = "main";
const ORIGIN_MAIN_REF = `refs/remotes/${DEFAULT_REMOTE}/${MAIN_BRANCH}`;
const CHECKED_OUT_COMMIT_REF = "HEAD";
const STABLE_RELEASE_TAG_PATTERN = /^v(\d+\.\d+\.\d+)$/u;

const tagName = process.env.GITHUB_REF_NAME;

try {
  verifyReleaseTag({ remote: DEFAULT_REMOTE, tagName });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function verifyReleaseTag({ remote, tagName: candidateTag }) {
  const versionMatch = candidateTag?.match(STABLE_RELEASE_TAG_PATTERN);
  if (!versionMatch) {
    throw new Error(
      `Release tag ${candidateTag ?? "(missing)"} is not a stable v<major>.<minor>.<patch> tag.`,
    );
  }

  const tagRef = `refs/tags/${candidateTag}`;
  fetchOriginMain(remote);
  fetchExactTag(remote, tagRef, candidateTag);
  requireAnnotatedTag(tagRef, candidateTag);

  // ^{commit} recursively peels an annotated tag and rejects a non-commit
  // target. This avoids comparing the tag-object ID with a commit ID.
  const tagCommit = gitOutput(["rev-parse", "--verify", `${tagRef}^{commit}`]);
  if (!tagCommit) {
    throw missingOrNonAnnotatedTag(candidateTag);
  }

  const mainCommit = gitOutput([
    "rev-parse",
    "--verify",
    `${ORIGIN_MAIN_REF}^{commit}`,
  ]);
  if (!mainCommit) {
    throw new Error(`Could not resolve ${DEFAULT_REMOTE}/${MAIN_BRANCH}.`);
  }

  // Bind the freshly fetched remote tag to the workflow code checkout so a
  // moved tag cannot validate one commit while the job executes another.
  const checkedOutCommit = gitOutput([
    "rev-parse",
    "--verify",
    `${CHECKED_OUT_COMMIT_REF}^{commit}`,
  ]);
  if (!checkedOutCommit || tagCommit !== checkedOutCommit) {
    throw new Error(
      `Release tag ${candidateTag} does not match the checked-out workflow commit.`,
    );
  }

  // Exact equality is intentional: ancestry checks would admit commits ahead
  // of or behind main and would not prove that review landed at the release ref.
  if (tagCommit !== mainCommit) {
    throw new Error(
      `Release tag ${candidateTag} does not target the exact ${DEFAULT_REMOTE}/${MAIN_BRANCH} commit.`,
    );
  }

  const packageVersion = readPackageVersion();
  const tagVersion = versionMatch[1];
  if (tagVersion !== packageVersion) {
    throw new Error(
      `Release tag version ${tagVersion} does not match package.json version ${packageVersion}.`,
    );
  }

  console.log(
    `Release tag ${candidateTag} is annotated, targets the exact ${DEFAULT_REMOTE}/${MAIN_BRANCH} commit, and matches package.json version ${packageVersion}.`,
  );
}

function fetchOriginMain(remote) {
  const source = `refs/heads/${MAIN_BRANCH}`;
  const result = runGit([
    "fetch",
    "--no-tags",
    "--force",
    "--no-write-fetch-head",
    remote,
    `+${source}:${ORIGIN_MAIN_REF}`,
  ]);
  if (result.status !== 0) {
    throw new Error(`Could not fetch ${remote}/${MAIN_BRANCH}.`);
  }
}

function fetchExactTag(remote, tagRef, candidateTag) {
  const result = runGit([
    "fetch",
    "--no-tags",
    "--force",
    "--no-write-fetch-head",
    remote,
    `+${tagRef}:${tagRef}`,
  ]);
  if (result.status !== 0) {
    throw missingOrNonAnnotatedTag(candidateTag);
  }
}

function requireAnnotatedTag(tagRef, candidateTag) {
  if (gitOutput(["cat-file", "-t", tagRef]) !== "tag") {
    throw missingOrNonAnnotatedTag(candidateTag);
  }
}

function missingOrNonAnnotatedTag(candidateTag) {
  return new Error(
    `Release tag ${candidateTag} is missing or is not an annotated tag.`,
  );
}

function readPackageVersion() {
  const parsed = JSON.parse(readFileSync("package.json", "utf8"));
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new Error("package.json does not contain a valid version string.");
  }
  return parsed.version;
}

function gitOutput(args) {
  const result = runGit(args);
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function runGit(args) {
  return spawnSync("git", args, { encoding: "utf8" });
}
