import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { scan } from "../src/scanner.js";
import type { Finding } from "../src/types.js";

const securityDiagnosticsV1Ids = new Set([
  "SEC-CREDENTIAL-IN-COMMAND-ARG",
  "SEC-PREDICTABLE-TEMP-PATH",
  "SEC-PRIVILEGED-COMMAND-WITHOUT-GUARD",
  "SEC-UNPINNED-DEPENDENCY-INSTALL",
  "SEC-UNPINNED-REMOTE-SCRIPT",
]);

test("remote script piped into shell is detected as high severity", async () => {
  const findings = await securityFindings(`
\`\`\`bash
curl https://example.com/install.sh | bash
curl -fsSLo install.sh https://example.com/install.sh
\`\`\`
`);

  const remoteScript = findingFor(findings, "SEC-UNPINNED-REMOTE-SCRIPT");
  assert.equal(remoteScript.severity, "high");
  assert.match(
    remoteScript.evidence.snippet,
    /curl https:\/\/example\.com\/install\.sh \| bash/,
  );
  assert.equal(
    findings.some(
      (finding) =>
        finding.id === "SEC-UNPINNED-REMOTE-SCRIPT" &&
        finding.evidence.snippet.includes("curl -fsSLo"),
    ),
    false,
  );
});

test("unpinned installs are detected without flagging pinned npm installs", async () => {
  const findings = await securityFindings(`
\`\`\`bash
npm install -g appium
npm install -g appium@3.0.0
docker pull selenium/standalone-chrome:latest
\`\`\`
`);

  const installFindings = findings.filter(
    (finding) => finding.id === "SEC-UNPINNED-DEPENDENCY-INSTALL",
  );
  assert.equal(installFindings.length, 2);
  assert.ok(
    installFindings.some((finding) =>
      finding.evidence.snippet.includes("npm install -g appium"),
    ),
  );
  assert.equal(
    installFindings.some((finding) =>
      finding.evidence.snippet.includes("appium@3.0.0"),
    ),
    false,
  );
  assert.ok(
    installFindings.some(
      (finding) =>
        finding.evidence.snippet.includes(
          "selenium/standalone-chrome:latest",
        ) && finding.severity === "medium",
    ),
  );
});

test("privileged commands require nearby guardrails", async () => {
  const unguarded = await securityFindings(`
\`\`\`bash
sudo rm -rf /Library/Example
\`\`\`
`);

  const guarded = await securityFindings(`
Ask the user for approval, scope only this path, make a backup, and verify rollback.
\`\`\`bash
sudo chmod -R 755 /Library/Example
\`\`\`
`);

  const privilegedFindings = unguarded.filter(
    (finding) => finding.id === "SEC-PRIVILEGED-COMMAND-WITHOUT-GUARD",
  );
  assert.equal(privilegedFindings.length, 1);
  assert.match(privilegedFindings[0]?.evidence.snippet ?? "", /sudo rm/);
  assert.equal(
    guarded.some(
      (finding) => finding.id === "SEC-PRIVILEGED-COMMAND-WITHOUT-GUARD",
    ),
    false,
  );
});

test("predictable temp paths are higher severity near sensitive wording", async () => {
  const sensitiveFindings = await securityFindings(`
\`\`\`bash
echo "$TOKEN" > /tmp/token
\`\`\`
`);
  const nonSensitiveFindings = await securityFindings(`
\`\`\`bash
touch /tmp/output
\`\`\`
`);

  const sensitiveTempFindings = sensitiveFindings.filter(
    (finding) => finding.id === "SEC-PREDICTABLE-TEMP-PATH",
  );
  const nonSensitiveTempFindings = nonSensitiveFindings.filter(
    (finding) => finding.id === "SEC-PREDICTABLE-TEMP-PATH",
  );
  assert.equal(sensitiveTempFindings.length, 1);
  assert.equal(nonSensitiveTempFindings.length, 1);
  assert.ok(
    sensitiveTempFindings.some(
      (finding) =>
        finding.evidence.snippet.includes("/tmp/token") &&
        finding.severity === "medium",
    ),
  );
  assert.ok(
    nonSensitiveTempFindings.some(
      (finding) =>
        finding.evidence.snippet.includes("/tmp/output") &&
        finding.severity === "low",
    ),
  );
});

test("literal credentials in command args are detected without treating env placeholders as literals", async () => {
  const findings = await securityFindings(`
\`\`\`bash
tool login --password mypassword
tool login --token $TOKEN
curl -H "Authorization: Bearer abc123" https://example.com
\`\`\`
`);

  const credentialFindings = findings.filter(
    (finding) => finding.id === "SEC-CREDENTIAL-IN-COMMAND-ARG",
  );
  assert.ok(
    credentialFindings.some(
      (finding) =>
        finding.evidence.snippet.includes("--password mypassword") &&
        finding.severity === "high",
    ),
  );
  assert.ok(
    credentialFindings.some(
      (finding) =>
        finding.evidence.snippet.includes("Authorization: Bearer abc123") &&
        finding.severity === "high",
    ),
  );
  assert.equal(
    credentialFindings.some(
      (finding) =>
        finding.evidence.snippet.includes("--token $TOKEN") &&
        finding.severity === "high",
    ),
    false,
  );
});

test("security findings are schema-compliant and deterministic", async () => {
  const root = await fixtureRoot(`
\`\`\`bash
curl https://example.com/install.sh | bash
npm install -g appium
docker run selenium/standalone-chrome:latest
sudo chown -R root /Library/Example
echo secret > /tmp/secret
tool login --token abc123
\`\`\`
`);

  const first = (await scan(root)).findings.filter((finding) =>
    securityDiagnosticsV1Ids.has(finding.id),
  );
  const second = (await scan(root)).findings.filter((finding) =>
    securityDiagnosticsV1Ids.has(finding.id),
  );

  assert.deepEqual(
    first.map((finding) => [
      finding.id,
      finding.evidence.path,
      finding.evidence.startLine,
    ]),
    second.map((finding) => [
      finding.id,
      finding.evidence.path,
      finding.evidence.startLine,
    ]),
  );
  assert.deepEqual(
    [...new Set(first.map((finding) => finding.id))].sort(),
    [...securityDiagnosticsV1Ids].sort(),
  );

  for (const finding of first) {
    assert.equal(finding.category, "safety");
    assert.equal("message" in finding, false);
    assert.ok(finding.title);
    assert.ok(finding.confidence);
    assert.ok(finding.evidence.path);
    assert.ok(finding.evidence.startLine > 0);
    assert.ok(finding.evidence.endLine >= finding.evidence.startLine);
    assert.ok(finding.whyItMatters);
    assert.ok(finding.remediation);
    assert.ok(finding.constraints?.length);
    assert.ok(finding.verificationSteps?.length);
    assert.ok(finding.llmHint);
  }
});

async function securityFindings(content: string): Promise<Finding[]> {
  return (await scan(await fixtureRoot(content))).findings.filter((finding) =>
    securityDiagnosticsV1Ids.has(finding.id),
  );
}

async function fixtureRoot(content: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-security-"));
  const skillsDir = path.join(root, "skills", "security");
  await mkdir(skillsDir, { recursive: true });
  await writeFile(
    path.join(skillsDir, "SKILL.md"),
    `# Security Fixture\n${content}`,
  );
  return root;
}

function findingFor(findings: Finding[], id: string): Finding {
  const finding = findings.find((candidate) => candidate.id === id);
  assert.ok(finding, `expected ${id}`);
  return finding;
}
