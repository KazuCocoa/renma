import { parseArgs } from "node:util";

import { validateAgentSkills } from "../agent-skills.js";
import { ConfigError, type ConfigOverrides } from "../config.js";
import { collectRepositorySnapshot } from "../repository-evidence.js";

export type ValidateSkillsFormat = "text" | "json";

export async function runValidateSkillsCli(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        config: { type: "string", short: "c" },
        format: { type: "string" },
        help: { type: "boolean", short: "h" },
        json: { type: "boolean" },
      },
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("Run `renma validate-skills --help` for usage.");
    return 2;
  }

  if (parsed.values.help) {
    console.log(validateSkillsHelp());
    return 0;
  }

  if (parsed.positionals.length > 1) {
    console.error("validate-skills accepts at most one repository path.");
    console.error("Run `renma validate-skills --help` for usage.");
    return 2;
  }

  const targetPath = parsed.positionals[0] ?? ".";
  const formatValue = parsed.values.json
    ? "json"
    : (stringValue(parsed.values.format) ?? "text");
  if (!isFormat(formatValue)) {
    console.error("--format must be one of: text, json.");
    console.error("Run `renma validate-skills --help` for usage.");
    return 2;
  }

  const overrides: ConfigOverrides = {};
  const config = stringValue(parsed.values.config);
  if (config) overrides.configPath = config;

  try {
    const snapshot = await collectRepositorySnapshot(targetPath, overrides);
    const report = validateAgentSkills(snapshot.documents);
    process.stdout.write(
      formatValue === "json"
        ? `${JSON.stringify(report, null, 2)}\n`
        : formatValidationText(report),
    );
    return report.invalidSkillCount > 0 ? 1 : 0;
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }
}

export function formatValidationText(
  report: ReturnType<typeof validateAgentSkills>,
): string {
  const lines = [
    "Agent Skills validation",
    `Specification: ${report.specification}`,
    `Profile: ${report.profile}`,
    `Skills: ${report.totalSkillCount}`,
    `Valid: ${report.validSkillCount}`,
    `Invalid: ${report.invalidSkillCount}`,
    `Legacy migration sources: ${report.legacySkillCount}`,
    `Hybrid migration sources: ${report.hybridSkillCount}`,
    `Authoring warnings: ${report.warningCount}`,
  ];

  for (const result of report.results) {
    lines.push("");
    lines.push(`${result.valid ? "VALID" : "INVALID"} ${result.path}`);
    lines.push(`  format: ${result.format}`);
    if (result.migrationRecommended) {
      lines.push("  migration: legacy -> Agent Skills canonical form");
    }
    for (const issue of result.issues) {
      lines.push(
        `  ${issue.severity.toUpperCase()} ${issue.code} L${issue.startLine}: ${issue.message}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function validateSkillsHelp(): string {
  return `renma validate-skills [path] [options]

Purpose
  Validate discovered SKILL.md files against https://agentskills.io/specification
  and report Renma authoring guidance for usage boundaries and prominent
  constraints. Specification errors exit 1; authoring warnings do not.

Options
  -c, --config <path>   Use an explicit Renma config file.
      --format <format> Output format: text or json. Defaults to text.
      --json            Alias for --format json.
  -h, --help            Show this help.

Examples
  renma validate-skills .
  renma validate-skills . --format json

Boundaries
  This command performs deterministic static validation. It does not select a
  skill for a live task, call an LLM, rewrite files, or guarantee runtime model
  compliance with instructions.
`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isFormat(value: string): value is ValidateSkillsFormat {
  return value === "text" || value === "json";
}
