import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

test("Security Policy Guide documents the current Skill and non-Skill syntax boundary", async () => {
  const guide = await readFile(
    path.join(process.cwd(), "docs/security-policy.md"),
    "utf8",
  );

  assert.match(guide, /### Canonical Skill security policy/);
  assert.match(guide, /name: local-triage/);
  assert.match(guide, /renma\.network-allowed: "false"/);
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

test("User Manual keeps script and asset contents outside security diagnostics", async () => {
  const [manual, guide] = await Promise.all([
    readFile(path.join(process.cwd(), "docs/user-manual.md"), "utf8"),
    readFile(path.join(process.cwd(), "docs/security-policy.md"), "utf8"),
  ]);

  assert.match(
    manual,
    /Text scripts and\s+data assets remain raw text for dedicated static path and inventory analysis;/,
  );
  assert.match(
    manual,
    /Renma does not analyze script or asset contents as\s+executable code\./,
  );
  assert.match(
    manual,
    /Security command analysis applies to eligible agent-facing\s+Markdown instructions that reference or invoke them\./,
  );
  assert.doesNotMatch(
    manual,
    /scripts and\s+data assets remain raw text for dedicated static path or security analysis/i,
  );
  assert.match(
    guide,
    /It does not analyze script or asset contents as executable\s+code;/,
  );
});
