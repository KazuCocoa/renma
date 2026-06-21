import path from "node:path";
import { buildCatalog } from "./catalog.js";
import { loadConfig, type ConfigOverrides } from "./config.js";
import { discoverArtifacts } from "./discovery.js";
import { parseDocument } from "./markdown.js";
import { runRules } from "./rules.js";
import type { Diagnostic, Finding, ScanResult } from "./types.js";

/** Run the complete deterministic scan pipeline for a target path. */
export async function scan(
  targetPath: string,
  overrides: ConfigOverrides = {},
): Promise<ScanResult> {
  const root = path.resolve(targetPath);
  const { config, configPath } = await loadConfig(root, overrides);
  const { artifacts, diagnostics } = await discoverArtifacts(root, config);
  const documents = artifacts.map(parseDocument);
  const catalogResult = buildCatalog(documents);
  const findings = [
    ...runRules(documents, config, catalogResult.catalog),
    ...catalogDiagnosticFindings(catalogResult.diagnostics),
  ].sort((a, b) => {
    const byPath = a.evidence.path.localeCompare(b.evidence.path);
    if (byPath !== 0) return byPath;
    return a.evidence.startLine - b.evidence.startLine;
  });

  return {
    root,
    ...(configPath ? { configPath } : {}),
    scannedFileCount: artifacts.length,
    format: config.format,
    findings,
    diagnostics,
    exitThreshold: config.failOn,
  };
}

function catalogDiagnosticFindings(diagnostics: Diagnostic[]): Finding[] {
  return diagnostics.map((diagnostic) => {
    const path = diagnostic.path ?? "(catalog)";
    const invalidStatus = diagnostic.message.match(/Invalid status "([^"]+)"/);
    if (invalidStatus) {
      return {
        id: "META-INVALID-STATUS",
        title: "Asset metadata uses an invalid lifecycle status",
        category: "maintenance",
        severity: "medium",
        confidence: "high",
        evidence: {
          path,
          startLine: 1,
          endLine: 1,
          snippet: diagnostic.message,
        },
        whyItMatters:
          "Lifecycle status is part of the repository governance contract. Invalid status values make it harder for humans and agents to understand whether a skill, context asset, or support file is experimental, stable, deprecated, or archived.",
        remediation:
          "Use one of the supported lifecycle status values: experimental, stable, deprecated, archived. Do not use migration or relationship states such as active or delegated as lifecycle status.",
        constraints: [
          "Do not introduce runtime context resolution.",
          "Do not create prompt packages.",
          "Do not silently rewrite metadata during scan.",
          "Keep lifecycle status separate from provenance, delegation, or replacement relationships.",
        ],
        verificationSteps: [
          "Run renma scan.",
          "Run renma catalog.",
          "Run any project-specific validation checks that apply to this repository.",
        ],
        llmHint:
          "Replace invalid lifecycle status values with supported values. If a file was replaced by a shared context asset, consider using status: deprecated plus a separate superseded_by field rather than status: delegated.",
      };
    }

    const missingId = /missing an id/i.test(diagnostic.message);
    const missingOwner = /missing an owner/i.test(diagnostic.message);
    return {
      id: missingId
        ? "META-MISSING-ID"
        : missingOwner
          ? "META-MISSING-OWNER"
          : "META-CATALOG-DIAGNOSTIC",
      title: missingId
        ? "Shared context asset is missing an id"
        : missingOwner
          ? "Shared context asset is missing an owner"
          : "Catalog metadata diagnostic",
      category: "maintenance",
      severity: "medium",
      confidence: "high",
      evidence: {
        path,
        startLine: 1,
        endLine: 1,
        snippet: diagnostic.message,
      },
      whyItMatters:
        "Catalog metadata is part of the repository governance contract. Missing or malformed metadata makes shared context ownership, lifecycle, and relationships harder to review and validate.",
      remediation:
        "Update the asset metadata so catalog construction can identify the asset and its owner.",
      constraints: [
        "Do not introduce runtime context resolution.",
        "Do not create prompt packages.",
        "Do not silently rewrite metadata during scan.",
      ],
      verificationSteps: [
        "Run renma scan.",
        "Run renma catalog.",
        "Run any project-specific validation checks that apply to this repository.",
      ],
      llmHint:
        "Add missing governance metadata using the repository's existing frontmatter style, then rerun scan and catalog.",
    };
  });
}
