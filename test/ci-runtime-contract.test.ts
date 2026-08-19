import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { parse } from "yaml";

type WorkflowStep = {
  "continue-on-error"?: boolean;
  env?: Record<string, string>;
  id?: string;
  if?: string;
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
};

type WorkflowJob = {
  environment?: string | { name?: string };
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

function actionStep(
  job: WorkflowJob | undefined,
  expectedIdentity: string,
): WorkflowStep | undefined {
  return steps(job).find(
    (step) => step.uses?.split("@", 1)[0] === expectedIdentity,
  );
}

const EXPECTED_ACTIONS_BY_FILE: Record<string, string[]> = {
  ".github/workflows/ci.yml": [
    "actions/checkout#v7",
    "actions/checkout#v7",
    "actions/checkout#v7",
    "actions/setup-node#v7",
    "actions/setup-node#v7",
    "actions/setup-node#v7",
    "SocketDev/action#v1.3.2",
    "SocketDev/action#v1.3.2",
    "SocketDev/action#v1.3.2",
  ],
  ".github/workflows/docs-pages.yml": [
    "actions/checkout#v7",
    "actions/configure-pages#v6",
    "actions/deploy-pages#v5",
    "actions/setup-node#v7",
    "actions/upload-pages-artifact#v5",
  ],
  ".github/workflows/npm-publish.yml": [
    "actions/checkout#v7",
    "actions/checkout#v7",
    "actions/checkout#v7",
    "actions/setup-node#v7",
    "actions/setup-node#v7",
  ],
  ".github/workflows/renma-ci-report.yml": [
    "actions/checkout#v7",
    "actions/download-artifact#v8",
    "actions/github-script#v9",
    "actions/setup-node#v7",
    "actions/upload-artifact#v7",
  ],
  "examples/github-actions/renma-ci-report.yml": [
    "actions/checkout#v6",
    "actions/download-artifact#v8",
    "actions/github-script#v9",
    "actions/setup-node#v6",
    "actions/upload-artifact#v7",
  ],
};

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
    actionStep(quality, "actions/setup-node")?.with?.["node-version"],
    "lts/*",
  );
  const qualityCommands = runCommands(quality).join("\n");
  for (const command of [
    "sfw npm ci",
    "npm run docs:build",
    "npm run lint",
    "npm run typecheck",
    "npm run typecheck:node-min",
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
    actionStep(minimum, "actions/setup-node")?.with?.["node-version"],
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
  const generator = workflow.jobs?.["generate-renma-reports"];
  assert.equal(
    actionStep(generator, "actions/checkout")?.with?.ref,
    "${{ github.event.pull_request.head.sha }}",
  );
  assert.equal(
    actionStep(generator, "actions/checkout")?.with?.["fetch-depth"],
    0,
  );
  const ciReport = steps(generator).find((step) => step.id === "ci-report");
  assert.deepEqual(ciReport?.env, {
    FROM_SHA: "${{ github.event.pull_request.base.sha }}",
    TO_SHA: "${{ github.event.pull_request.head.sha }}",
  });
  assert.match(ciReport?.run ?? "", /--from "\$\{FROM_SHA\}"/);
  assert.match(ciReport?.run ?? "", /--to "\$\{TO_SHA\}"/);
  assert.match(ciReport?.run ?? "", /--fail-on-status warn/);
  assert.doesNotMatch(source, /github\.base_ref|origin\/\$\{|--to HEAD/);
  assert.match(source, /github\.event\.pull_request/);
  assert.match(source, /node dist\/index\.js ci-report/);
  assert.match(source, /node dist\/index\.js scan \. --fail-on high --strict/);
});

test("supported-platform CI keeps focused macOS and Windows evidence", () => {
  const workflow = readWorkflow(".github/workflows/ci.yml");
  const packageVerifier = readFileSync("scripts/verify-package.mjs", "utf8");
  const platform = workflow.jobs?.["supported-platform-evidence"];
  const platformSteps = steps(platform);
  assert.deepEqual(platform?.strategy?.matrix, {
    os: ["macos-latest", "windows-latest"],
  });
  assert.equal(
    actionStep(platform, "actions/checkout")?.with?.["fetch-depth"],
    0,
  );
  assert.equal(
    actionStep(platform, "actions/setup-node")?.with?.["node-version"],
    "lts/*",
  );

  const installStepIndex = platformSteps.findIndex(
    (step) => step.name === "Install dependencies",
  );
  const firewallStepIndex = platformSteps.findIndex((step) =>
    step.uses?.startsWith("SocketDev/action@"),
  );
  const installCommand = platformSteps[installStepIndex]?.run?.trim();
  const firewallMode = platformSteps[firewallStepIndex]?.with?.mode;
  const socketProtectedInstall =
    firewallStepIndex >= 0 &&
    firewallStepIndex < installStepIndex &&
    firewallMode === "firewall-free" &&
    installCommand === "sfw npm ci";
  const scriptlessInstall = installCommand === "npm ci --ignore-scripts";
  assert.ok(
    socketProtectedInstall || scriptlessInstall,
    "platform dependency installation must use Socket Firewall or disable lifecycle scripts",
  );
  assert.notEqual(installCommand, "npm ci");

  const commands = runCommands(platform).join("\n");
  for (const command of [
    "npm run build",
    "npx --no-install tsc -p tsconfig.test.json",
    "dist-test/test/repository-paths.test.js",
    "dist-test/test/helper-command-evidence.test.js",
    "dist-test/test/executable-dependency-analyzer.test.js",
    "dist-test/test/public-json-compatibility.test.js",
    "npm run verify:package",
    "node scripts/verify-platform-smoke.mjs",
  ]) {
    assert.ok(commands.includes(command), command);
  }
  assert.doesNotMatch(commands, /npm run docs:build|npm run lint|npm test/);
  assert.match(
    packageVerifier,
    /const NPM_COMMAND = process\.platform === "win32" \? "npm\.cmd" : "npm";/,
  );
  assert.equal(
    [...packageVerifier.matchAll(/spawnSync\(\s*NPM_COMMAND,/gu)].length,
    2,
  );
});

test("public Renma report is a portable exact package-consumer workflow", () => {
  const source = readFileSync(
    "examples/github-actions/renma-ci-report.yml",
    "utf8",
  );
  const workflow = readWorkflow("examples/github-actions/renma-ci-report.yml");
  const generator = workflow.jobs?.["generate-renma-reports"];
  const commenter = workflow.jobs?.["comment-renma-ci-report"];
  const commands = runCommands(generator).join("\n");
  const packageVersion = (
    JSON.parse(readFileSync("package.json", "utf8")) as { version: string }
  ).version;
  const expectedInstall = `npm install --save-dev --save-exact renma@${packageVersion}`;

  assert.ok(
    source.split(/\r?\n/u).some((line) => {
      const trimmed = line.trimStart();
      return (
        trimmed.startsWith("#") && trimmed.slice(1).trim() === expectedInstall
      );
    }),
    `missing complete maintained command: ${expectedInstall}`,
  );
  assert.match(commands, /npm ci/);
  assert.match(commands, /npx --no-install renma catalog/);
  assert.match(commands, /npx --no-install renma graph/);
  assert.match(commands, /npx --no-install renma ci-report/);
  assert.match(commands, /npx --no-install renma scan/);
  assert.doesNotMatch(source, /npm run build|node dist\/index\.js/);
  assert.equal(
    actionStep(generator, "actions/checkout")?.with?.["fetch-depth"],
    0,
  );
  assert.equal(
    actionStep(generator, "actions/checkout")?.with?.ref,
    "${{ github.event.pull_request.head.sha }}",
  );
  const ciReport = steps(generator).find((step) => step.id === "ci-report");
  assert.deepEqual(ciReport?.env, {
    FROM_SHA: "${{ github.event.pull_request.base.sha }}",
    TO_SHA: "${{ github.event.pull_request.head.sha }}",
  });
  assert.match(ciReport?.run ?? "", /--from "\$\{FROM_SHA\}"/);
  assert.match(ciReport?.run ?? "", /--to "\$\{TO_SHA\}"/);
  assert.doesNotMatch(source, /github\.base_ref|origin\/\$\{|--to HEAD/);
  assert.deepEqual(generator?.permissions, { contents: "read" });
  assert.equal(commenter?.needs, "generate-renma-reports");
  assert.deepEqual(commenter?.permissions, {
    actions: "read",
    contents: "read",
    "pull-requests": "write",
  });
});

test("npm publishing verifies the exact release ref before OIDC publication", () => {
  const workflow = readWorkflow(".github/workflows/npm-publish.yml");
  assert.deepEqual(workflow.permissions, { contents: "read" });

  const refVerification = workflow.jobs?.["verify-release-ref"];
  assert.equal(refVerification?.permissions, undefined);
  assert.match(
    runCommands(refVerification).join("\n"),
    /node scripts\/verify-release-tag\.mjs/,
  );

  const validation = workflow.jobs?.["validate-supported-runtime"];
  assert.deepEqual(validation?.strategy?.matrix?.runtime, ["minimum", "lts"]);
  const validationSteps = steps(validation);
  assert.match(
    validationSteps.find((step) => step.id === "minimum-node")?.run ?? "",
    /node scripts\/min-supported-node\.mjs/,
  );
  assert.equal(
    actionStep(validation, "actions/setup-node")?.with?.["node-version"],
    "${{ matrix.runtime == 'minimum' && steps.minimum-node.outputs.version || 'lts/*' }}",
  );
  const validationCommands = runCommands(validation).join("\n");
  for (const command of [
    "npm ci",
    "npm test",
    "npm run typecheck:node-min",
    "npm run build",
    "npm run verify:package",
  ]) {
    assert.match(validationCommands, new RegExp(command));
  }
  assert.doesNotMatch(validationCommands, /npm publish/);

  const publish = workflow.jobs?.publish;
  assert.deepEqual(publish?.needs, [
    "verify-release-ref",
    "validate-supported-runtime",
  ]);
  assert.equal(publish?.environment, "npm-publish");
  assert.deepEqual(publish?.permissions, {
    contents: "read",
    "id-token": "write",
  });
  const publishSteps = steps(publish);
  assert.equal(
    actionStep(publish, "actions/setup-node")?.with?.["node-version"],
    "lts/*",
  );
  const publishCommands = runCommands(publish).join("\n");
  assert.doesNotMatch(publishCommands, /tag_version=|verify-release-tag/);
  assert.match(publishCommands, /npm run verify:package/);
  assert.match(publishCommands, /npm publish/);
});

test("all external GitHub Actions use expected identities at immutable SHAs", () => {
  const workflowFiles = readdirSync(".github/workflows")
    .filter((file) => file.endsWith(".yml"))
    .map((file) => `.github/workflows/${file}`)
    .sort();
  assert.deepEqual(
    workflowFiles,
    Object.keys(EXPECTED_ACTIONS_BY_FILE)
      .filter((file) => file.startsWith(".github/workflows/"))
      .sort(),
    "every repository workflow must be covered by the immutable-action contract",
  );

  for (const [file, expectedActions] of Object.entries(
    EXPECTED_ACTIONS_BY_FILE,
  )) {
    const source = readFileSync(file, "utf8");
    const usesLines = source
      .split(/\r?\n/u)
      .filter((line) => /^\s*(?:-\s*)?uses:/u.test(line));
    const actualActions = usesLines.map((line) => {
      const match = line.match(
        /^\s*(?:-\s*)?uses:\s+([^@\s]+)@([0-9a-f]{40})\s+#\s+(v\d+(?:\.\d+){0,2})\s*$/u,
      );
      assert.ok(
        match,
        `${file} must pin this external action to a full SHA with a release-tag comment: ${line.trim()}`,
      );
      return `${match[1]}#${match[3]}`;
    });

    assert.deepEqual(
      actualActions.sort(),
      [...expectedActions].sort(),
      `${file} action identities or intended release tags changed`,
    );
  }
});

test("Dependabot retains the GitHub Actions updater", () => {
  const source = readFileSync(".github/dependabot.yml", "utf8");
  assert.match(source, /package-ecosystem: ["']?github-actions["']?/u);
});

test("release security documentation preserves the external trust boundary", () => {
  const source = readFileSync("docs/development/release-security.md", "utf8");
  assert.match(source, /exact workflow filename `npm-publish\.yml`/u);
  assert.match(source, /`npm-publish` environment/u);
  assert.match(source, /Publication job size review/u);
  assert.match(
    source,
    /rebuilds and verifies the publishable package state\s+immediately before `npm publish`/u,
  );
  assert.match(
    source,
    /`npm publish` performs packaging again[\s\S]+does not claim byte identity/u,
  );
  assert.doesNotMatch(source, /produces and verifies the exact bytes/u);
  assert.match(source, /current repeated validation is therefore acceptable/u);
  assert.match(source, /required reviewers/u);
  assert.match(source, /deployment branch\/tag rules/u);
  assert.match(source, /ruleset targeting\s+`v\*`/u);
  assert.match(
    source,
    /Removing\s+`environment: npm-publish`[\s\S]+must cause npm trusted\s+publishing to reject/u,
  );
  assert.match(
    source,
    /same-workflow checks are not sufficient against an attacker who can\s+modify and push the tagged workflow commit/u,
  );
  assert.match(source, /Repository code[\s\S]+cannot verify/u);
});
