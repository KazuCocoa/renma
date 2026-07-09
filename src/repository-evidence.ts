import path from "node:path";
import { buildCatalog } from "./catalog.js";
import { loadConfig, type ConfigOverrides } from "./config.js";
import {
  summarizeContextLensGovernance,
  type ContextLensSummary,
} from "./context-lens.js";
import { discoverArtifacts } from "./discovery.js";
import { parseDocument } from "./markdown.js";
import type { Catalog } from "./model.js";
import type { Diagnostic } from "./types.js";

export interface RepositoryEvidence {
  root: string;
  configPath?: string;
  scannedFileCount: number;
  catalog: Catalog;
  contextLens: ContextLensSummary;
  diagnostics: Diagnostic[];
}

export async function collectRepositoryEvidence(
  targetPath: string,
  overrides: ConfigOverrides = {},
): Promise<RepositoryEvidence> {
  const root = path.resolve(targetPath);
  const { config, configPath } = await loadConfig(root, overrides);
  const { artifacts, diagnostics } = await discoverArtifacts(root, config);
  const documents = artifacts.map(parseDocument);
  const built = buildCatalog(documents);
  const contextLens = summarizeContextLensGovernance(documents, built.catalog);

  return {
    root,
    ...(configPath ? { configPath } : {}),
    scannedFileCount: artifacts.length,
    catalog: built.catalog,
    contextLens: contextLens.summary,
    diagnostics: [
      ...diagnostics,
      ...built.diagnostics,
      ...contextLens.diagnostics,
    ],
  };
}
