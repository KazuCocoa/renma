import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("Security Policy Guide documents the 0.16 Skill and non-Skill syntax boundary", async () => {
  const guide = await readFile(
    path.join(process.cwd(), "docs/security-policy.md"),
    "utf8",
  );

  assert.match(guide, /### Canonical Skill security policy/);
  assert.match(guide, /name: local-triage/);
  assert.match(guide, /renma\.network-allowed: "true"/);
  assert.match(guide, /renma\.allowed-data: '\["repo-local-files"/);
  assert.match(guide, /renma\.security-profile: local-ci-diagnostics/);
  assert.match(guide, /### Non-Skill security policy/);
  assert.match(guide, /network_allowed: true/);
  assert.match(
    guide,
    /Pre-0\.16\s+top-level Skill security fields are accepted only by `suggest-metadata`/,
  );
  assert.match(guide, /Invalid recognized canonical values fail\s+closed/);
});
