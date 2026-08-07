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
  assert.match(
    guide,
    /field-level provenance[\s\S]*direct asset-local declaration change[\s\S]*owning Skill[\s\S]*reusable security profile[\s\S]*repository security\s+configuration/,
  );
  assert.match(
    guide,
    /JSON retains the complete sorted[\s\S]*Markdown uses the shared presentation limit/,
  );
  assert.match(
    guide,
    /Approved-policy destinations remain distinct from destinations that[\s\S]*instruction evidence mentions[\s\S]*observed[\s\S]*runtime connection or upload/,
  );
  assert.match(
    guide,
    /reporting-only:[\s\S]*does not add detectors[\s\S]*change `scan --fail-on`[\s\S]*change CI pass\/warn\/fail status or exit behavior/,
  );
});

test("User Manual documents bounded policy-boundary CI details and complete JSON", async () => {
  const manual = await readFile(
    path.join(process.cwd(), "docs/user-manual.md"),
    "utf8",
  );

  assert.match(manual, /diff\.security\.policyChanges/);
  assert.match(manual, /diff\.security\.sharedPolicyChanges/);
  assert.match(
    manual,
    /Removed forbidden inputs[\s\S]*removed disallowed commands[\s\S]*`none declared`/,
  );
  assert.match(
    manual,
    /Markdown shows[\s\S]*bounded by the shared\s+presentation limit;[\s\S]*JSON retains every asset\s+and every value/,
  );
  assert.match(
    manual,
    /`direct`,\s+`inherited`, `mixed`, or `unresolved`[\s\S]*`mixed` means that both a direct asset[\s\S]*inherited evidence contributed/,
  );
  assert.match(
    manual,
    /`unresolved` means exact field-level attribution[\s\S]*known partial sources may remain/,
  );
  assert.match(
    manual,
    /access[\s\S]*becomes enabled[\s\S]*effective destination scope[\s\S]*shared\s+presentation limit[\s\S]*JSON retains the complete/,
  );
  assert.match(
    manual,
    /does not change CI status or exit[\s\S]*`scan --fail-on`[\s\S]*Readiness score[\s\S]*Readiness level/,
  );
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
