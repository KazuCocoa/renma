import type { ScanResult } from "./types/scan-result.js";
import type { ExecutableSurfaceInventory } from "./executable-surface-inventory.js";

/** Format one complete JSON document with two-space indentation and one newline. */
export function formatJsonDocument(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Format a scan result as pretty-printed JSON. */
export function formatJson(result: ScanResult): string {
  return formatJsonDocument(result);
}

/** Format a scan result as human-readable terminal text. */
export function formatText(result: ScanResult): string {
  const lines = [
    `Renma scan`,
    `Root: ${result.root}`,
    `Config: ${result.configPath ?? "(defaults)"}`,
    `Files scanned: ${result.scannedFileCount}`,
    `Agent Skills: ${result.agentSkills.validSkillCount}/${result.agentSkills.totalSkillCount} valid (${result.agentSkills.invalidSkillCount} invalid, ${result.agentSkills.legacySkillCount} legacy, ${result.agentSkills.hybridSkillCount} hybrid)`,
    ...(result.contextLens
      ? [
          `Context lenses: ${result.contextLens.validLensCount}/${result.contextLens.totalLensCount} valid (${result.contextLens.invalidLensCount} invalid)`,
          `Context lens diagnostics: error ${result.contextLens.diagnosticCounts.error}, warning ${result.contextLens.diagnosticCounts.warning}, info ${result.contextLens.diagnosticCounts.info}`,
        ]
      : []),
    `Diagnostics: ${result.diagnostics.length}`,
    `Exit threshold: ${result.exitThreshold}`,
    `Findings: ${result.findings.length}`,
    ...(result.executableSurfaceInventory
      ? formatExecutableSurfaceInventoryText(result.executableSurfaceInventory)
      : []),
  ];

  for (const skill of result.agentSkills.results) {
    if (skill.issues.length === 0) continue;
    lines.push("");
    lines.push(`${skill.valid ? "VALID" : "INVALID"} ${skill.path}`);
    for (const issue of skill.issues) {
      lines.push(
        `  ${issue.severity.toUpperCase()} ${issue.code} L${issue.startLine}: ${issue.message}`,
      );
    }
    if (skill.migrationCommand) {
      lines.push("");
      lines.push("  Migration:");
      lines.push(`    ${skill.migrationCommand.display}`);
    }
  }

  if (result.findings.length === 0) {
    lines.push("No rule findings.");
  }

  for (const diagnostic of result.diagnostics) {
    lines.push(
      `diagnostic ${diagnostic.severity}: ${diagnostic.path ? `${diagnostic.path}: ` : ""}${diagnostic.message}`,
    );
  }

  for (const finding of result.findings) {
    lines.push("");
    const risk = finding.riskClass ? ` [${finding.riskClass}]` : "";
    lines.push(
      `${finding.severity.toUpperCase()}${risk} ${finding.id}: ${finding.title}`,
    );
    lines.push(`  ${finding.evidence.path}:${finding.evidence.startLine}`);
    if (finding.evidence.snippet)
      lines.push(`  evidence: ${finding.evidence.snippet}`);
    lines.push(`  why: ${finding.whyItMatters}`);
    lines.push(`  fix: ${finding.remediation}`);
    if (finding.constraints && finding.constraints.length > 0)
      lines.push(`  constraints: ${finding.constraints.join("; ")}`);
    if (finding.verificationSteps && finding.verificationSteps.length > 0)
      lines.push(`  verify: ${finding.verificationSteps.join("; ")}`);
    if (finding.llmHint) lines.push(`  llm: ${finding.llmHint}`);
  }

  return `${lines.join("\n")}\n`;
}

/** Render the compact inventory section shared by terminal-facing reports. */
export function formatExecutableSurfaceInventoryText(
  inventory: ExecutableSurfaceInventory,
): string[] {
  const summary = inventory.summary;
  const lines = [
    "",
    "Executable Surface Inventory",
    `  Surfaces: ${summary.totalSurfaces} (${summary.skillLocalSurfaces} Skill-local, ${summary.repositoryToolSurfaces} repository tools, ${summary.noncanonicalSurfaces} non-canonical)`,
    `  Skill-local reachability: ${summary.reachableSkillLocalSurfaces} reachable, ${summary.unreachableSkillLocalSurfaces} unreachable`,
    `  References/invocations: ${summary.referencedSurfaces} referenced, ${summary.invokedSurfaces} invoked`,
    `  Effective security policy: ${summary.surfacesWithEffectivePolicy} covered, ${summary.surfacesWithoutEffectivePolicy} without`,
    `  Invocation resolution: ${summary.resolvedInvocations} resolved, ${summary.missingInvocations} missing, ${summary.unsafeInvocations} unsafe, ${summary.unscopedInvocations} unscoped, ${summary.noncanonicalInvocations} non-canonical, ${summary.unavailableInvocations} unavailable`,
  ];
  if (inventory.surfaces.length === 0) {
    lines.push("  Surfaces: (none)");
    return lines;
  }
  for (const surface of inventory.surfaces) {
    const reachability =
      surface.scope === "skill-local"
        ? surface.reachableFromOwningSkill
          ? `reachable@${surface.reachabilityDepth}`
          : "unreachable"
        : "n/a";
    lines.push(
      `  - ${surface.path} [${surface.scope}; ${surface.interpreterHints.join(",")}; reachability ${reachability}; invocations ${surface.invocationCount}; policy ${surface.securityPolicy.hasEffectivePolicy ? "effective" : "none"}]`,
    );
  }
  return lines;
}
