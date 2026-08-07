import assert from "node:assert/strict";
import { test } from "node:test";

import fc from "fast-check";

import { COMMAND_HELP, type CommandName } from "../src/cli-help.js";
import { COMMAND_REGISTRY, comparisonRefs, main } from "../src/cli.js";
import { classifyCliError, CLI_EXIT, CliUserError } from "../src/cli-errors.js";
import { ConfigError } from "../src/config.js";
import { RepositoryFixture } from "./repository-fixture.js";

const DEFAULT_FORMATS: Partial<Record<CommandName, string>> = {
  scan: "text",
  catalog: "json",
  graph: "json",
  "execution-contract": "json",
  "skill-index": "markdown",
  "trust-graph": "json",
  readiness: "json",
  bom: "json",
  ownership: "json",
  diff: "json",
  "ci-report": "markdown",
  inspect: "json",
  guide: "prompt",
  scaffold: "file",
  "suggest-metadata": "prompt",
  "suggest-semantic-split": "prompt",
};

const JSON_SHORTCUTS: Record<CommandName, boolean> = {
  init: false,
  scan: true,
  catalog: true,
  graph: true,
  "execution-contract": true,
  "skill-index": true,
  "trust-graph": true,
  readiness: true,
  bom: true,
  ownership: true,
  diff: true,
  "ci-report": true,
  inspect: true,
  guide: true,
  scaffold: false,
  "suggest-metadata": true,
  "suggest-semantic-split": true,
};

test("the command registry binds every help definition to one complete contract", () => {
  assert.deepEqual(
    Object.keys(COMMAND_REGISTRY).toSorted(),
    COMMAND_HELP.map(({ name }) => name).toSorted(),
  );

  fc.assert(
    fc.property(
      fc.constantFrom(...COMMAND_HELP.map(({ name }) => name)),
      (name) => {
        const help = COMMAND_HELP.find((candidate) => candidate.name === name);
        const spec = COMMAND_REGISTRY[name];
        assert.ok(help);
        assert.equal(spec.name, name);
        assert.equal(spec.help, help);
        assert.equal(typeof spec.execute, "function");
        assert.ok(spec.positionals.minPositionals >= 0);
        assert.ok(
          spec.positionals.maxPositionals >= spec.positionals.minPositionals,
        );
        assert.deepEqual(spec.optionNames, [
          ...new Set(
            help.options.map((option) =>
              typeof option === "string" ? option : option.name,
            ),
          ),
        ]);
      },
    ),
    { seed: 22_050, numRuns: 100 },
  );
});

test("registered default formats preserve every command default", () => {
  for (const command of COMMAND_HELP) {
    assert.equal(
      COMMAND_REGISTRY[command.name].defaultFormat,
      DEFAULT_FORMATS[command.name],
      command.name,
    );
    assert.equal(
      COMMAND_REGISTRY[command.name].optionNames.includes("json"),
      JSON_SHORTCUTS[command.name],
      `${command.name} --json`,
    );
  }
});

test("the registry dispatches every command to its command-specific parser", async (t) => {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-cli-registry-",
    testContext: t,
  });
  const init = await captureConsole(() => main(["init", fixture.root]));
  assert.equal(init.code, 0);
  assert.match(init.stdout, /Renma is initialized for this repository/);
  assert.match(await fixture.read("renma.config.jsonc"), /"fail_on": "high"/);

  const cases: readonly {
    name: CommandName;
    argv: string[];
    expectedError: RegExp;
  }[] = [
    {
      name: "scan",
      argv: ["scan", "--format", "yaml"],
      expectedError: /--format must be either text or json/,
    },
    {
      name: "catalog",
      argv: ["catalog", "--format", "yaml"],
      expectedError: /--format must be either json or markdown/,
    },
    {
      name: "graph",
      argv: ["graph", "--view", "unknown"],
      expectedError: /--view must be one of/,
    },
    {
      name: "execution-contract",
      argv: ["execution-contract", "--format", "yaml"],
      expectedError: /--format must be json/,
    },
    {
      name: "skill-index",
      argv: ["skill-index", "--json", "--format", "markdown"],
      expectedError: /--json conflicts/,
    },
    {
      name: "trust-graph",
      argv: ["trust-graph", "--format", "yaml"],
      expectedError: /--format must be either json or markdown/,
    },
    {
      name: "readiness",
      argv: ["readiness", "--format", "yaml"],
      expectedError: /--format must be either json or markdown/,
    },
    {
      name: "bom",
      argv: ["bom", "--format", "yaml"],
      expectedError: /--format must be either json or markdown/,
    },
    {
      name: "ownership",
      argv: ["ownership", "--format", "yaml"],
      expectedError: /--format must be either json or markdown/,
    },
    {
      name: "diff",
      argv: ["diff"],
      expectedError:
        /diff requires a comparison baseline via --from <ref> or --base <ref>/,
    },
    {
      name: "ci-report",
      argv: ["ci-report"],
      expectedError:
        /ci-report requires a comparison baseline via --from <ref> or --base <ref>/,
    },
    {
      name: "inspect",
      argv: ["inspect", "README.md", "--format", "yaml"],
      expectedError: /--format must be either text or json/,
    },
    {
      name: "guide",
      argv: ["guide", "unknown"],
      expectedError: /Unknown guide topic "unknown"/,
    },
    {
      name: "scaffold",
      argv: ["scaffold", "unknown", "target.md", "--format", "prompt"],
      expectedError: /scaffold requires kind skill, context, or context_lens/,
    },
    {
      name: "suggest-metadata",
      argv: ["suggest-metadata", "README.md", "--format", "yaml"],
      expectedError: /--format must be either prompt or json/,
    },
    {
      name: "suggest-semantic-split",
      argv: ["suggest-semantic-split", "README.md", "--format", "yaml"],
      expectedError: /--format must be either prompt or json/,
    },
  ];

  for (const item of cases) {
    const result = await captureConsole(() => main(item.argv));
    assert.equal(result.code, 2, item.name);
    assert.equal(result.stdout, "", item.name);
    assert.match(result.stderr, item.expectedError, item.name);
    assert.match(result.stderr, new RegExp(`renma ${item.name} --help`));
  }
});

test("comparison refs share aliases, conflict handling, and the HEAD default", () => {
  for (const command of ["diff", "ci-report"] as const) {
    assert.deepEqual(comparisonRefs({ from: "main" }, command), {
      fromRef: "main",
      toRef: "HEAD",
    });
    assert.deepEqual(comparisonRefs({ base: "main" }, command), {
      fromRef: "main",
      toRef: "HEAD",
    });
    assert.deepEqual(
      comparisonRefs({ from: "main", to: "candidate" }, command),
      { fromRef: "main", toRef: "candidate" },
    );
    assert.deepEqual(
      comparisonRefs({ base: "main", to: "candidate" }, command),
      { fromRef: "main", toRef: "candidate" },
    );
    assert.deepEqual(comparisonRefs({ from: "main", base: "main" }, command), {
      error: "Use either --from or --base, not both.",
    });
    const missing = comparisonRefs({}, command);
    assert.match(
      "error" in missing ? missing.error : "",
      /requires a comparison baseline/,
    );
  }
});

test("CLI error classification reserves exit 3 for unexpected failures", () => {
  assert.deepEqual(classifyCliError(new ConfigError("bad config")), {
    exitCode: CLI_EXIT.userError,
    message: "bad config",
  });
  assert.deepEqual(classifyCliError(new CliUserError("bad input")), {
    exitCode: CLI_EXIT.userError,
    message: "bad input",
  });
  assert.deepEqual(classifyCliError(new Error("broken invariant")), {
    exitCode: CLI_EXIT.internalError,
    message: "Renma internal error: broken invariant",
  });
});

test("main reports an injected unexpected command failure as exit 3", async () => {
  const originalExecute = COMMAND_REGISTRY.scan.execute;
  COMMAND_REGISTRY.scan.execute = async () => {
    throw new Error("injected command failure");
  };
  try {
    const result = await captureConsole(() => main(["scan", "."]));
    assert.equal(result.code, CLI_EXIT.internalError);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      "Renma internal error: injected command failure\n",
    );
    assert.doesNotMatch(result.stderr, /\n\s+at\s+/);
  } finally {
    COMMAND_REGISTRY.scan.execute = originalExecute;
  }
});

test("diff and ci-report expose the same comparison-ref CLI contract", async (t) => {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-comparison-refs-",
    testContext: t,
  });
  await fixture.initializeGit();
  await fixture.write("README.md", "# Baseline\n");
  await fixture.git(["add", "."]);
  await fixture.git(["commit", "-m", "baseline"]);
  await fixture.git(["checkout", "-b", "feature"]);
  await fixture.write("README.md", "# Feature\n");
  await fixture.git(["add", "."]);
  await fixture.git(["commit", "-m", "feature"]);

  for (const command of ["diff", "ci-report"] as const) {
    for (const refs of [
      ["--from", "main", "--to", "HEAD"],
      ["--base", "main", "--to", "HEAD"],
      ["--from", "main"],
      ["--base", "main"],
    ]) {
      const result = await captureConsole(() =>
        main([command, fixture.root, ...refs, "--format", "json"]),
      );
      assert.equal(
        result.code,
        CLI_EXIT.success,
        `${command} ${refs.join(" ")}`,
      );
      assert.equal(result.stderr, "");
      const report = JSON.parse(result.stdout) as {
        from: { ref: string };
        to: { ref: string };
      };
      assert.equal(report.from.ref, "main");
      assert.equal(report.to.ref, "HEAD");
    }

    const conflict = await captureConsole(() =>
      main([command, fixture.root, "--from", "main", "--base", "main"]),
    );
    assert.equal(conflict.code, CLI_EXIT.userError);
    assert.equal(conflict.stdout, "");
    assert.match(conflict.stderr, /Use either --from or --base, not both/);

    const missing = await captureConsole(() => main([command, fixture.root]));
    assert.equal(missing.code, CLI_EXIT.userError);
    assert.equal(missing.stdout, "");
    assert.match(missing.stderr, /requires a comparison baseline/);

    for (const refs of [
      ["--from", "missing-from"],
      ["--base", "missing-base"],
      ["--base", "main", "--to", "missing-to"],
    ]) {
      const invalid = await captureConsole(() =>
        main([command, fixture.root, ...refs, "--format", "json"]),
      );
      assert.equal(
        invalid.code,
        CLI_EXIT.userError,
        `${command} ${refs.join(" ")}`,
      );
      assert.equal(invalid.stdout, "");
      assert.match(invalid.stderr, /Could not resolve Git comparison ref/);
      assert.match(invalid.stderr, /missing-(?:from|base|to)/);
      assert.doesNotMatch(invalid.stderr, /Renma internal error/);
    }
  }
});

test("diff and ci-report classify invalid comparison targets as user errors", async (t) => {
  const fixture = await RepositoryFixture.create({
    prefix: "renma-invalid-comparison-target-",
    testContext: t,
  });
  await fixture.write("README.md", "# Not a Git repository\n");

  for (const command of ["diff", "ci-report"] as const) {
    const notGit = await captureConsole(() =>
      main([command, fixture.root, "--base", "HEAD"]),
    );
    assert.equal(notGit.code, CLI_EXIT.userError);
    assert.equal(notGit.stdout, "");
    assert.match(notGit.stderr, /not an appropriate Git repository/);

    const missing = await captureConsole(() =>
      main([command, fixture.resolve("missing"), "--base", "HEAD"]),
    );
    assert.equal(missing.code, CLI_EXIT.userError);
    assert.equal(missing.stdout, "");
    assert.match(missing.stderr, /Could not read diff target/);
  }
});

async function captureConsole(
  callback: () => Promise<number>,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const log = console.log;
  const error = console.error;
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  let stdout = "";
  let stderr = "";
  console.log = (...values: unknown[]) => {
    stdout += `${values.map(String).join(" ")}\n`;
  };
  console.error = (...values: unknown[]) => {
    stderr += `${values.map(String).join(" ")}\n`;
  };
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;
  try {
    return { code: await callback(), stdout, stderr };
  } finally {
    console.log = log;
    console.error = error;
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  }
}
