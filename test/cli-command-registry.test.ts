import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import fc from "fast-check";

import { COMMAND_HELP, type CommandName } from "../src/cli-help.js";
import { COMMAND_REGISTRY, main } from "../src/cli.js";

const DEFAULT_FORMATS: Partial<Record<CommandName, string>> = {
  scan: "text",
  catalog: "json",
  graph: "json",
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

test("the registry dispatches every command to its command-specific parser", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "renma-cli-registry-"));
  try {
    const init = await captureConsole(() => main(["init", root]));
    assert.equal(init.code, 0);
    assert.match(init.stdout, /Renma is initialized for this repository/);
    assert.match(
      await readFile(path.join(root, "renma.config.json"), "utf8"),
      /"fail_on": "high"/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }

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
      expectedError: /diff requires --from <ref> and --to <ref>/,
    },
    {
      name: "ci-report",
      argv: ["ci-report"],
      expectedError: /ci-report requires --from <ref> and --to <ref>/,
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
