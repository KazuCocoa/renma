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
    /Markdown destination and repository-link semantics[\s\S]*shared Markdown parser[\s\S]*reference definition supplies target identity only/,
  );
  assert.match(
    guide,
    /unknown` Markdown only when[\s\S]*does\s+not grant new metadata or[\s\S]*security-policy authority/,
  );
  assert.match(
    guide,
    /Registered security-policy identifiers are a narrower ASCII trust boundary[\s\S]*never recovers or interprets the corrupted key's[\s\S]*value/,
  );
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
    /`diff\.security\.policyTransitions`[\s\S]*opposite[\s\S]*cannot cancel/,
  );
  assert.match(
    guide,
    /false -> unspecified[\s\S]*true -> unspecified[\s\S]*no effective declaration/,
  );
  assert.match(
    guide,
    /security\.ci_policy[\s\S]*defaults to `"fail"`[\s\S]*off < warn < fail/,
  );
  assert.match(
    guide,
    /security_policy_ci\.network_relaxed[\s\S]*security_policy_ci\.approved_network_destination_added[\s\S]*security_policy_ci\.allowed_data_added[\s\S]*security_policy_ci\.forbidden_input_removed[\s\S]*security_policy_ci\.disallowed_command_removed[\s\S]*not considered verified remediation/,
  );
});

test("User Manual documents bounded policy-boundary CI details and complete JSON", async () => {
  const manual = await readFile(
    path.join(process.cwd(), "docs/user-manual.md"),
    "utf8",
  );

  assert.match(manual, /diff\.security\.policyChanges/);
  assert.match(manual, /diff\.security\.policyTransitions/);
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
    /accumulating lists[\s\S]*normalized effective declaration additions and removals[\s\S]*same added or removed value, each source is retained[\s\S]*redundant contributor[\s\S]*does not erase another/,
  );
  assert.match(
    manual,
    /access[\s\S]*becomes enabled[\s\S]*effective destination scope[\s\S]*shared\s+presentation limit[\s\S]*JSON retains the complete/,
  );
  assert.match(
    manual,
    /security_policy_ci\.network_relaxed[\s\S]*security_policy_ci\.approved_network_destination_added[\s\S]*security_policy_ci\.allowed_data_added[\s\S]*security_policy_ci\.forbidden_input_removed[\s\S]*security_policy_ci\.disallowed_command_removed/,
  );
  assert.match(
    manual,
    /Adding an approved network destination[\s\S]*allowed-data value[\s\S]*Removing a forbidden input or disallowed command[\s\S]*relaxation/,
  );
  assert.match(
    manual,
    /default is `fail`[\s\S]*off < warn < fail[\s\S]*fail -> off[\s\S]*cannot bypass/,
  );
  assert.match(
    manual,
    /reduction in scan findings caused by[\s\S]*not considered verified remediation[\s\S]*Removing or correcting the[\s\S]*valid remediation/,
  );
});

test("documentation keeps bounded dependency evidence outside security diagnostics", async () => {
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
    /Security diagnostics do not analyze script or\s+asset contents as executable behavior\.[\s\S]*only\s+recognizes its documented bounded static dependency relationships/,
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
    /recognizes only documented static import, re-export,\s+execution, and source relationships;[\s\S]*PowerShell module resolution,[\s\S]*general script behavior remain outside the boundary/,
  );
});
