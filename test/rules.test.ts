import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { formatText } from "../src/report.js";
import { scan } from "../src/scanner.js";

test("scan preserves local support reachability and profile findings", async () => {
  const root = await fixture();
  const skillDir = path.join(root, "skills", "demo");
  await mkdir(path.join(skillDir, "profiles"), { recursive: true });
  await mkdir(path.join(skillDir, "references"), { recursive: true });
  await mkdir(path.join(skillDir, "examples"), { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---
description: This skill has a long enough description for deterministic scanning but intentionally omits the fixture file map so the support checks remain visible.
---
# Demo Skill

## Preflight
Collect the task context before acting.

## Verification
Verify the result with a test command.

## Do Not Use For
Do not use for production credential changes.
`,
  );
  await writeFile(
    path.join(skillDir, "profiles", "mobile.md"),
    "# Mobile Profile\nUse this profile for mobile test work.\n",
  );
  await writeFile(
    path.join(skillDir, "references", "secret.md"),
    "api_key = abcdefghijk12345\n",
  );
  await writeFile(
    path.join(skillDir, "examples", "happy-path.md"),
    "# Happy Path\nUse this example for simple tasks.\n",
  );

  const result = await scan(root);
  const ids = result.findings.map((finding) => finding.id);

  assert.ok(ids.includes("SUPPORT-MISSING-REACHABILITY-GUIDANCE"));
  assert.ok(ids.includes("SUPPORT-UNREACHABLE-PROFILE"));
  assert.ok(ids.includes("SUPPORT-UNREACHABLE-REFERENCE"));
  assert.ok(ids.includes("SUPPORT-UNREACHABLE-EXAMPLE"));
  assert.ok(ids.includes("PROF-MISSING-BASE"));
  assert.ok(ids.includes("SEC-LITERAL-SECRET"));

  const reachabilityFinding = result.findings.find(
    (finding) => finding.id === "SUPPORT-MISSING-REACHABILITY-GUIDANCE",
  );
  assert.match(
    reachabilityFinding?.whyItMatters ?? "",
    /statically discoverable/,
  );
  assert.ok(
    reachabilityFinding?.constraints?.includes(
      "Do not introduce runtime context resolution.",
    ),
  );
  assert.ok(
    reachabilityFinding?.verificationSteps?.includes("Run renma scan."),
  );
  assert.ok(
    reachabilityFinding?.verificationSteps?.includes(
      "Run any project-specific validation checks that apply to this repository.",
    ),
  );
  assert.ok(!reachabilityFinding?.verificationSteps?.includes("Run npm test."));
  assert.match(reachabilityFinding?.llmHint ?? "", /reachability guidance/);

  const textReport = formatText(result);
  assert.match(
    textReport,
    /constraints: Do not introduce runtime context resolution/,
  );
  assert.match(
    textReport,
    /verify: Run renma scan\.; Run any project-specific validation checks/,
  );
  assert.match(textReport, /llm: Add concise reachability guidance/);

  const unreachableFinding = result.findings.find((finding) =>
    finding.id.startsWith("SUPPORT-UNREACHABLE-"),
  );
  assert.match(
    unreachableFinding?.whyItMatters ?? "",
    /static repository evidence/,
  );
  assert.ok(
    unreachableFinding?.constraints?.includes(
      "Do not delete or summarize support content just to satisfy the check.",
    ),
  );
});

test("scan advises when a skill contains reusable context candidates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-rules-"));
  const skillDir = path.join(root, "skills", "mobile");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---
name: workflow-review
description: Use this skill for workflow review tasks when routing requires setup, troubleshooting, testing heuristics, examples, preflight checks, and verification guidance.
---
# Workflow Review

Use this skill when reviewing workflow behavior.

## Setup
Install the project dependencies.
Configure the local environment.
Capture the workflow logs.
Keep setup guidance current.

## Decision Logic
Workflow behavior can differ after a resumed review.
Known issue: state refresh may retry slowly.
Avoid assuming the first run is representative.

## Troubleshooting
Environment state can be flaky in local fixtures.
Retry only after collecting logs.
Workflow-specific failures should keep their reproduction notes.

## Testing Heuristics
Best practice: include offline and resume cases.
Edge case coverage should include missing-owner behavior.
Risk: approval state may expire during review.
Do not use for production incident response.

## Examples
Input: workflow readiness review.
Output: review notes with risks.

## Preflight
Check fixture access and target workflow version.

## Verification
Run the workflow test command and confirm result.
`,
  );

  const result = await scan(root, {});
  const finding = result.findings.find(
    (candidate) => candidate.id === "MAINT-SKILL-REUSABLE-CONTEXT-CANDIDATE",
  );

  assert.equal(finding?.severity, "low");
  assert.equal(finding?.category, "maintenance");
  assert.equal(finding?.confidence, "medium");
  assert.match(finding?.evidence.snippet ?? "", /Detected reusable-knowledge/);
  assert.match(finding?.evidence.snippet ?? "", /Setup/);
  assert.match(finding?.evidence.snippet ?? "", /Troubleshooting/);
  assert.match(finding?.evidence.snippet ?? "", /known issue/);
  assert.ok(
    finding?.constraints?.includes("Do not make Renma select runtime context."),
  );
  assert.match(finding?.llmHint ?? "", /without adding runtime context/);
});

test("scan does not advise reusable context extraction for tiny skills", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-rules-"));
  const skillDir = path.join(root, "skills", "tiny");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---
name: tiny
description: Use this skill for tiny routing fixtures when examples, preflight checks, and verification guidance are enough.
---
# Tiny

Use this skill when a fixture needs a known issue mention.
Do not use for production work.
Example input and output.
Preflight check.
Verification result.
`,
  );

  const result = await scan(root, {});

  assert.equal(
    result.findings.some(
      (finding) => finding.id === "MAINT-SKILL-REUSABLE-CONTEXT-CANDIDATE",
    ),
    false,
  );
});

test("scan preserves security finding evidence paths", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "skills", "demo"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "demo", "SKILL.md"),
    "# Demo\n\npassword = abcdefghijk12345\n",
  );

  const result = await scan(root);
  const secretFinding = result.findings.find(
    (finding) => finding.id === "SEC-LITERAL-SECRET",
  );

  assert.equal(secretFinding?.evidence.path, "skills/demo/SKILL.md");
  assert.equal(secretFinding?.evidence.startLine, 3);
  assert.match(secretFinding?.evidence.snippet ?? "", /password/);
});

test("scan warns when nested support assets exceed token guidance", async () => {
  const root = await fixture();
  const skillDir = path.join(root, "skills", "demo");
  await mkdir(path.join(skillDir, "references"), { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---
description: This skill routes to references for detailed context and includes enough description to avoid the short-description finding.
---
# Demo Skill

## Local Support Guidance
For detailed reference material, load references/large.md.

## Do Not Use For
Do not use for unrelated tasks.

## Preflight
Collect the target context first.

## Verification
Verify the result with a test.
`,
  );
  await writeFile(
    path.join(skillDir, "references", "large.md"),
    `# Large Reference\n\n${repeatWords("context", 850)}\n`,
  );

  const result = await scan(root);
  const contextBudgetFinding = result.findings.find(
    (finding) => finding.id === "QUAL-SUPPORT-ASSET-TOKEN-BUDGET",
  );

  assert.equal(
    contextBudgetFinding?.evidence.path,
    "skills/demo/references/large.md",
  );
  assert.match(contextBudgetFinding?.title ?? "", /Support asset exceeds/);
  assert.match(contextBudgetFinding?.whyItMatters ?? "", /modular enough/);
  assert.ok(
    contextBudgetFinding?.constraints?.includes(
      "Preserve concrete procedural steps losslessly.",
    ),
  );
  assert.ok(
    contextBudgetFinding?.verificationSteps?.includes("Run renma scan."),
  );
  assert.ok(
    contextBudgetFinding?.verificationSteps?.includes(
      "Run the repository-specific validation or test command, if one exists.",
    ),
  );
  assert.ok(
    !contextBudgetFinding?.verificationSteps?.includes("Run npm test."),
  );
  assert.match(contextBudgetFinding?.llmHint ?? "", /meaning-based ordered/);
});

test("scan emits actionable guidance for oversized skills", async () => {
  const root = await fixture();
  const skillDir = path.join(root, "skills", "large");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---
name: Large Skill
description: Use this skill for large-context governance checks that need static support references.
---
# Large Skill
## Use When
Use for repository governance review.
## Do Not Use For
Do not use for runtime context selection.
## Preflight
Collect the target repository path.
## Procedure
${repeatWords("procedure", 560)}
## Verification
Run npm test.
`,
  );

  const result = await scan(root);
  const skillBudgetFinding = result.findings.find(
    (finding) => finding.id === "QUAL-SKILL-TOKEN-BUDGET",
  );

  assert.equal(skillBudgetFinding?.evidence.path, "skills/large/SKILL.md");
  assert.match(skillBudgetFinding?.whyItMatters ?? "", /Large skills can mix/);
  assert.ok(
    skillBudgetFinding?.constraints?.includes(
      "Do not make Renma responsible for selecting context.",
    ),
  );
  assert.ok(skillBudgetFinding?.verificationSteps?.includes("Run renma scan."));
  assert.ok(
    skillBudgetFinding?.verificationSteps?.includes(
      "Run any project-specific validation checks that apply to this repository.",
    ),
  );
  assert.ok(!skillBudgetFinding?.verificationSteps?.includes("Run npm test."));
  assert.match(skillBudgetFinding?.llmHint ?? "", /first-class context assets/);
});

test("scan does not advise tiny skill-local references as shared context candidates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-rules-"));
  const skillDir = path.join(root, "skills", "demo");
  await mkdir(path.join(skillDir, "references"), { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `# Demo Skill

Use this skill when reviewing demo flows.

## Local Support Guidance
Load references/checklist.md when the user asks for the demo checklist.

## Do Not Use For
Unrelated setup work.

## Preflight
Confirm the target flow.

## Verification
Run the relevant check.
`,
  );
  await writeFile(
    path.join(skillDir, "references", "checklist.md"),
    `# Demo Checklist

- Check the local fixture.
- Capture the expected output.
`,
  );

  const result = await scan(root);

  assert.ok(
    !result.findings.some(
      (finding) =>
        finding.id === "MAINT-SUPPORT-ASSET-SHARED-CONTEXT-CANDIDATE",
    ),
  );
});

test("scan ignores frontmatter-only support asset signals", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-rules-"));
  const skillDir = path.join(root, "skills", "setup");
  await mkdir(path.join(skillDir, "references"), { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `# Setup Skill

Use this skill when reviewing setup notes.

## Local Support Guidance
Load references/procedure-index.md for a local checklist.

## Do Not Use For
Unrelated troubleshooting.

## Preflight
Confirm the target workflow.

## Verification
Run the setup check.
`,
  );
  await writeFile(
    path.join(skillDir, "references", "procedure-index.md"),
    `---
name: decision-logic-validation-procedure
status: delegated
---

# Local Checklist

- Confirm the note still applies to this skill.
- Keep this short local checklist beside the setup skill.
- Do not promote metadata-only matches into shared contexts.
- Record the local owner before editing this checklist.
- Verify the related skill still references this file.
`,
  );

  const result = await scan(root);

  assert.ok(
    !result.findings.some(
      (finding) =>
        finding.id === "MAINT-SUPPORT-ASSET-SHARED-CONTEXT-CANDIDATE",
    ),
  );
});

test("scan does not advise generic local one-off examples as shared context candidates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-rules-"));
  const skillDir = path.join(root, "skills", "review");
  await mkdir(path.join(skillDir, "references"), { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `# Review Skill

Use this skill when reviewing one local workflow.

## Local Support Guidance
Load references/example-response.md only when checking the sample response.

## Do Not Use For
General policy review.

## Preflight
Confirm the local workflow.

## Verification
Compare the response.
`,
  );
  await writeFile(
    path.join(skillDir, "references", "example-response.md"),
    `# Example Response

## Input
A local review request for one workflow.

## Output
The response should mention the exact local fixture.

## Notes
Use this only as an example for the review skill.
Prefer the wording from the skill when the example drifts.
Do not treat this sample as team policy.
Validate only against the local fixture named by the task.
`,
  );

  const result = await scan(root);

  assert.ok(
    !result.findings.some(
      (finding) =>
        finding.id === "MAINT-SUPPORT-ASSET-SHARED-CONTEXT-CANDIDATE",
    ),
  );
});

test("scan advises generic source-of-truth support references as shared context candidates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-rules-"));
  const skillDir = path.join(root, "skills", "workflow");
  await mkdir(path.join(skillDir, "references"), { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `# Workflow Skill

Use this skill when validating operational workflows.

## Local Support Guidance
Load references/operating-procedure.md for decision and validation guidance.

## Do Not Use For
Production incident response.

## Preflight
Confirm the target workflow and owner.

## Verification
Run the workflow validation command.
`,
  );
  await writeFile(
    path.join(skillDir, "references", "operating-procedure.md"),
    `# Operating Procedure

## Decision Logic
Choose the review path based on the workflow owner, risk level, and rollback needs.

## Troubleshooting
Known issue: stale local state can make a completed workflow appear incomplete.
The reviewer should capture the first failing command before changing inputs.

## Validation
Validate the owner, expected output, and rollback note before marking the workflow ready.

## Constraints
Do not remove required approvals when promoting this guidance into shared context.
Prefer stable procedure names over ad hoc local aliases.

## Failure Modes
A missing owner, missing rollback note, or stale fixture should block completion.
Avoid mixing one skill's reading order with reusable procedure guidance.

## Verification
Verify the workflow after each fix and record the checked command.
`,
  );

  const result = await scan(root);
  const finding = result.findings.find(
    (candidate) =>
      candidate.id === "MAINT-SUPPORT-ASSET-SHARED-CONTEXT-CANDIDATE",
  );

  assert.equal(finding?.severity, "low");
  assert.equal(finding?.confidence, "medium");
  assert.equal(finding?.category, "maintenance");
  assert.equal(
    finding?.evidence.path,
    "skills/workflow/references/operating-procedure.md",
  );
  assert.match(finding?.evidence.snippet ?? "", /Decision Logic/);
  assert.match(finding?.evidence.snippet ?? "", /Validation/);
  assert.ok(finding?.constraints?.length);
  assert.ok(finding?.verificationSteps?.length);
  assert.match(finding?.llmHint ?? "", /Search the repository/);
  assert.match(finding?.llmHint ?? "", /overlapping guidance/);
  assert.doesNotMatch(JSON.stringify(finding), /tool\/platform\/domain/i);
  assert.doesNotMatch(JSON.stringify(finding), /runtime[- ]resolver/i);
});

test("scan advises when shared context paths use process-state segments", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-rules-"));
  await mkdir(path.join(root, "contexts", "promoted"), { recursive: true });
  await writeFile(
    path.join(root, "contexts", "promoted", "workflow-setup.md"),
    `---
id: workflow.setup
owner: platform
status: stable
---

# Workflow Setup

Use this context when reviewing workflow setup ownership.
`,
  );

  const result = await scan(root);
  const finding = result.findings.find(
    (candidate) => candidate.id === "MAINT-CONTEXT-PATH-NON-SEMANTIC",
  );

  assert.equal(finding?.severity, "low");
  assert.equal(finding?.confidence, "high");
  assert.equal(finding?.category, "maintenance");
  assert.equal(finding?.evidence.path, "contexts/promoted/workflow-setup.md");
  assert.match(finding?.evidence.snippet ?? "", /promoted/);
  assert.match(finding?.remediation ?? "", /contexts\/tools\/<tool>/);
  assert.ok(finding?.constraints?.length);
  assert.ok(finding?.verificationSteps?.length);
  assert.match(finding?.llmHint ?? "", /Infer semantic scope/);
  assert.doesNotMatch(JSON.stringify(finding), /runtime[- ]resolver/i);
});

test("scan accepts semantic shared context path families", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-rules-"));
  const paths = [
    path.join(root, "contexts", "tools", "runner", "setup.md"),
    path.join(root, "contexts", "domain", "payment", "idempotency.md"),
    path.join(root, "contexts", "testing", "boundary-value-analysis.md"),
  ];
  for (const filePath of paths) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(
      filePath,
      `---
id: ${path.basename(filePath, ".md")}
owner: platform
status: stable
---

# Context

Reusable source-of-truth context.
`,
    );
  }

  const result = await scan(root);

  assert.ok(
    !result.findings.some(
      (finding) => finding.id === "MAINT-CONTEXT-PATH-NON-SEMANTIC",
    ),
  );
});

test("scan does not inspect non-context staging folders as context path findings", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-rules-"));
  await mkdir(path.join(root, ".migration", "promoted"), { recursive: true });
  await writeFile(
    path.join(root, ".migration", "promoted", "workflow-setup.md"),
    "# Workflow Setup\n",
  );

  const result = await scan(root);

  assert.equal(result.scannedFileCount, 0);
  assert.ok(
    !result.findings.some(
      (finding) => finding.id === "MAINT-CONTEXT-PATH-NON-SEMANTIC",
    ),
  );
});

test("scan treats support files referenced through an index reference as reachable", async () => {
  const root = await fixture();
  const skillDir = path.join(root, "skills", "setup");
  const referenceDir = path.join(skillDir, "references");
  await mkdir(referenceDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---
description: This skill uses an index reference to route ordered setup context parts without listing every part in the skill.
---
# Setup Skill

## Local Support Guidance
For setup, load references/setup.md.

## Do Not Use For
Do not use for unrelated setup.

## Preflight
Collect the target platform first.

## Verification
Verify the setup with a test.
`,
  );
  await writeFile(
    path.join(referenceDir, "setup.md"),
    `# Setup Index

Load these ordered parts:

1. setup-01.md
2. setup-02.md
`,
  );
  await writeFile(
    path.join(referenceDir, "setup-01.md"),
    "# Setup Part 1\n",
  );
  await writeFile(
    path.join(referenceDir, "setup-02.md"),
    "# Setup Part 2\n",
  );

  const result = await scan(root);
  const unusedReferencePaths = result.findings
    .filter((finding) => finding.id === "SUPPORT-UNREACHABLE-REFERENCE")
    .map((finding) => finding.evidence.path);

  assert.deepEqual(unusedReferencePaths, []);
});

test("scan warns on hardcoded user home paths in skill instructions", async () => {
  const root = await fixture();
  const skillDir = path.join(root, "skills", "demo");
  await mkdir(skillDir, { recursive: true });

  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---
description: Demo skill for local path guidance.
---

# Demo Skill

## Preflight
Use /Users/😺/ for temporary files.

## Verification
Verify the result with a command.
`,
  );

  const result = await scan(root);
  const ids = result.findings.map((finding) => finding.id);

  assert.ok(ids.includes("QUAL-USER-LOCAL-PATHS"));
});

test("scan allows portable home path placeholders in skill instructions", async () => {
  const root = await fixture();
  const skillDir = path.join(root, "skills", "demo");
  await mkdir(skillDir, { recursive: true });

  await writeFile(
    path.join(skillDir, "SKILL.md"),
    `---
description: Demo skill for portable home path guidance.
---

# Demo Skill

## Preflight
Use $HOME/cache or ~/cache for temporary files.

## Verification
Verify the result with a command.
`,
  );

  const result = await scan(root);
  const ids = result.findings.map((finding) => finding.id);

  assert.ok(!ids.includes("QUAL-USER-LOCAL-PATHS"));
});

async function fixture(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "renma-rules-"));
}

function repeatWords(word: string, count: number): string {
  return Array.from({ length: count }, () => word).join(" ");
}
