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
import { collectRepositoryPaths } from "./repository-paths.js";
import type {
  Artifact,
  Diagnostic,
  ParsedDocument,
  ScanConfig,
} from "./types.js";

export interface RepositoryEvidence {
  root: string;
  configPath?: string;
  scannedFileCount: number;
  catalog: Catalog;
  contextLens: ContextLensSummary;
  diagnostics: Diagnostic[];
}

export interface RepositorySnapshot extends RepositoryEvidence {
  config: ScanConfig;
  artifacts: Artifact[];
  documents: ParsedDocument[];
  repositoryPaths: ReadonlySet<string>;
  discoveryDiagnostics: Diagnostic[];
  catalogDiagnostics: Diagnostic[];
  contextLensDiagnostics: Diagnostic[];
}

export async function collectRepositoryEvidence(
  targetPath: string,
  overrides: ConfigOverrides = {},
): Promise<RepositoryEvidence> {
  const snapshot = await collectRepositorySnapshot(targetPath, overrides);
  return {
    root: snapshot.root,
    ...(snapshot.configPath ? { configPath: snapshot.configPath } : {}),
    scannedFileCount: snapshot.scannedFileCount,
    catalog: snapshot.catalog,
    contextLens: snapshot.contextLens,
    diagnostics: snapshot.diagnostics,
  };
}

export async function collectRepositorySnapshot(
  targetPath: string,
  overrides: ConfigOverrides = {},
): Promise<RepositorySnapshot> {
  const root = path.resolve(targetPath);
  const { config, configPath } = await loadConfig(root, overrides);
  const {
    artifacts,
    diagnostics: discoveryDiagnostics,
    discoveredPaths,
  } = await discoverArtifacts(root, config);
  const documents = artifacts.map(parseDocument);
  const built = buildCatalog(documents);
  const contextLens = summarizeContextLensGovernance(documents, built.catalog);
  const repositoryPaths = await collectRepositoryPaths(
    root,
    artifacts,
    documents,
    built.catalog,
    discoveredPaths,
  );

  return {
    root,
    ...(configPath ? { configPath } : {}),
    config,
    artifacts,
    documents,
    repositoryPaths,
    scannedFileCount: artifacts.length,
    catalog: built.catalog,
    contextLens: contextLens.summary,
    discoveryDiagnostics,
    catalogDiagnostics: built.diagnostics,
    contextLensDiagnostics: contextLens.diagnostics,
    diagnostics: [
      ...discoveryDiagnostics,
      ...built.diagnostics,
      ...contextLens.diagnostics,
    ],
  };
}
