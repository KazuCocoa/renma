import { validateAgentSkills } from "../agent-skills.js";
import { ConfigError, type ConfigOverrides } from "../config.js";
import { collectRepositorySnapshot } from "../repository-evidence.js";

export type ValidateSkillsFormat = "text" | "json";

export async function runValidateSkillsCommand(
  targetPath: string,
  options: { format: ValidateSkillsFormat; configPath?: string },
): Promise<number> {
  const overrides: ConfigOverrides = options.configPath
    ? { configPath: options.configPath }
    : {};
  try {
    const snapshot = await collectRepositorySnapshot(targetPath, overrides);
    const report = validateAgentSkills(snapshot.documents);
    process.stdout.write(
      options.format === "json"
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
