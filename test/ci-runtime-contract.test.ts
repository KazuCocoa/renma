import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

type WorkflowStep = {
  "continue-on-error"?: boolean;
  id?: string;
  if?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
};

type WorkflowJob = {
  name?: string;
  needs?: string | string[];
  permissions?: Record<string, string>;
  steps?: WorkflowStep[];
  strategy?: {
    matrix?: Record<string, unknown>;
  };
};

type Workflow = {
  on?: Record<string, { branches?: string[] }>;
  permissions?: Record<string, string>;
  jobs?: Record<string, WorkflowJob>;
};

function readWorkflow(path: string): Workflow {
  return parse(readFileSync(path, "utf8")) as Workflow;
}

function steps(job: WorkflowJob | undefined): WorkflowStep[] {
  assert.ok(job?.steps, "expected workflow job steps");
  return job.steps;
}

function runCommands(job: WorkflowJob | undefined): string[] {
  return steps(job).flatMap((step) => (step.run ? [step.run] : []));
}

test("minimum Node helper derives the normalized package engine floor", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
    engines?: { node?: string };
  };
  const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8")) as {
    packages?: Record<string, { engines?: { node?: string } }>;
  };
  assert.equal(packageJson.engines?.node, ">=22.17.0");
  assert.equal(
    packageLock.packages?.[""]?.engines?.node,
    packageJson.engines.node,
  );

  const result = spawnSync("node", ["scripts/min-supported-node.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "22.17.0\n");
  assert.equal(result.stderr, "");
});

test("primary CI preserves LTS quality and adds exact-floor compatibility", () => {
  const workflow = readWorkflow(".github/workflows/ci.yml");
  assert.deepEqual(workflow.on?.pull_request?.branches, ["main"]);
  assert.deepEqual(workflow.on?.push?.branches, ["main"]);
  assert.deepEqual(workflow.permissions, { contents: "read" });

  const quality = workflow.jobs?.["lint-format-and-test"];
  assert.equal(quality?.name, "ESLint, Prettier, and Tests");
  const qualitySteps = steps(quality);
  assert.equal(
    qualitySteps.find((step) => step.uses === "actions/setup-node@v7")?.with?.[
      "node-version"
    ],
    "lts/*",
  );
  const qualityCommands = runCommands(quality).join("\n");
  for (const command of [
    "sfw npm ci",
    "npm run docs:build",
    "npm run lint",
    "npm run typecheck",
    "npm run format:check",
    "npm run build",
    "npm run test",
    "npm run verify:package",
  ]) {
    assert.match(qualityCommands, new RegExp(command.replaceAll("*", "\\*")));
  }

  const minimum = workflow.jobs?.["minimum-node-compatibility"];
  assert.equal(minimum?.name, "Minimum supported Node compatibility");
  const minimumSteps = steps(minimum);
  assert.match(
    minimumSteps.find((step) => step.id === "minimum-node")?.run ?? "",
    /node scripts\/min-supported-node\.mjs/,
  );
  assert.equal(
    minimumSteps.find((step) => step.uses === "actions/setup-node@v7")?.with?.[
      "node-version"
    ],
    "${{ steps.minimum-node.outputs.version }}",
  );
  const minimumCommands = runCommands(minimum).join("\n");
  for (const command of [
    "sfw npm ci",
    "npm run build",
    "npm run test",
    "npm run verify:package",
  ]) {
    assert.match(minimumCommands, new RegExp(command));
  }
  assert.doesNotMatch(minimumCommands, /docs:build|npm run lint|format:check/);
});

test("push-to-main CI validates the merged target and valid push range", () => {
  const source = readFileSync(".github/workflows/ci.yml", "utf8");
  const workflow = readWorkflow(".github/workflows/ci.yml");
  const qualitySteps = steps(workflow.jobs?.["lint-format-and-test"]);
  const strictScan = qualitySteps.find((step) =>
    step.run?.includes("node dist/index.js scan . --fail-on high --strict"),
  );
  assert.equal(strictScan?.if, "github.event_name == 'push'");
  assert.equal(strictScan?.id, "post_merge_scan");
  assert.equal(strictScan?.["continue-on-error"], true);

  const previousMain = qualitySteps.find((step) => step.id === "previous_main");
  assert.match(previousMain?.run ?? "", /\^0\+\$/);
  assert.match(previousMain?.run ?? "", /git cat-file -e/);
  assert.match(previousMain?.run ?? "", /available=false/);

  const comparison = qualitySteps.find((step) =>
    step.run?.includes("node dist/index.js ci-report ."),
  );
  assert.match(comparison?.if ?? "", /github\.event_name == 'push'/);
  assert.match(
    comparison?.if ?? "",
    /steps\.previous_main\.outputs\.available == 'true'/,
  );
  assert.match(comparison?.run ?? "", /--from "\$\{FROM_SHA\}"/);
  assert.match(comparison?.run ?? "", /--to "\$\{TO_SHA\}"/);
  assert.match(comparison?.run ?? "", /--fail-on-status warn/);
  assert.equal(comparison?.id, "post_merge_comparison");
  assert.equal(comparison?.["continue-on-error"], true);
  const enforcement = qualitySteps.find(
    (step) => step.name === "Enforce post-merge Renma validation",
  );
  assert.match(enforcement?.if ?? "", /steps\.post_merge_scan\.outcome/);
  assert.match(enforcement?.if ?? "", /steps\.post_merge_comparison\.outcome/);
  assert.doesNotMatch(source, /github\.base_ref|github\.event\.pull_request/);
});

test("dedicated Renma report remains PR-only", () => {
  const workflow = readWorkflow(".github/workflows/renma-ci-report.yml");
  assert.deepEqual(workflow.on?.pull_request?.branches, ["main"]);
  assert.equal(workflow.on?.push, undefined);

  const source = readFileSync(".github/workflows/renma-ci-report.yml", "utf8");
  assert.match(source, /github\.base_ref/);
  assert.match(source, /github\.event\.pull_request/);
  assert.match(source, /node dist\/index\.js ci-report/);
  assert.match(source, /node dist\/index\.js scan \. --fail-on high --strict/);
});

test("npm publishing waits for exact-floor and LTS validation", () => {
  const workflow = readWorkflow(".github/workflows/npm-publish.yml");
  assert.deepEqual(workflow.permissions, { contents: "read" });

  const validation = workflow.jobs?.["validate-supported-runtime"];
  assert.deepEqual(validation?.strategy?.matrix?.runtime, ["minimum", "lts"]);
  const validationSteps = steps(validation);
  assert.match(
    validationSteps.find((step) => step.id === "minimum-node")?.run ?? "",
    /node scripts\/min-supported-node\.mjs/,
  );
  assert.equal(
    validationSteps.find((step) => step.uses === "actions/setup-node@v7")
      ?.with?.["node-version"],
    "${{ matrix.runtime == 'minimum' && steps.minimum-node.outputs.version || 'lts/*' }}",
  );
  const validationCommands = runCommands(validation).join("\n");
  for (const command of [
    "npm ci",
    "npm test",
    "npm run build",
    "npm run verify:package",
  ]) {
    assert.match(validationCommands, new RegExp(command));
  }
  assert.doesNotMatch(validationCommands, /npm publish/);

  const publish = workflow.jobs?.publish;
  assert.equal(publish?.needs, "validate-supported-runtime");
  assert.deepEqual(publish?.permissions, {
    contents: "read",
    "id-token": "write",
  });
  const publishSteps = steps(publish);
  assert.equal(
    publishSteps.find((step) => step.uses === "actions/setup-node@v7")?.with?.[
      "node-version"
    ],
    "lts/*",
  );
  const publishCommands = runCommands(publish).join("\n");
  assert.match(publishCommands, /tag_version=/);
  assert.match(publishCommands, /npm run verify:package/);
  assert.match(publishCommands, /npm publish/);
});
