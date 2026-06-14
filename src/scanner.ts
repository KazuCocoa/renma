import path from "node:path";
import { loadConfig, type ConfigOverrides } from "./config.js";
import { discoverArtifacts } from "./discovery.js";
import { parseDocument } from "./markdown.js";
import { runRules } from "./rules.js";
import type { ScanResult } from "./types.js";

export async function scan(targetPath: string, overrides: ConfigOverrides = {}): Promise<ScanResult> {
  const root = path.resolve(targetPath);
  const { config, configPath } = await loadConfig(root, overrides);
  const { artifacts, diagnostics } = await discoverArtifacts(root, config);
  const documents = artifacts.map(parseDocument);
  const findings = runRules(documents);

  return {
    root,
    ...(configPath ? { configPath } : {}),
    scannedFileCount: artifacts.length,
    format: config.format,
    findings,
    diagnostics,
    exitThreshold: config.failOn
  };
}
