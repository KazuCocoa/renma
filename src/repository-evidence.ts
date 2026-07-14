import path from "node:path";
import {
  buildCatalog,
  buildSkillParentIndex,
  type SkillParentIndex,
} from "./catalog.js";
import { loadConfig, type ConfigOverrides } from "./config.js";
import {
  summarizeContextLensGovernance,
  type ContextLensSummary,
} from "./context-lens.js";
import { discoverArtifacts } from "./discovery.js";
import { buildClassificationEvidenceIndex } from "./evidence/classification.js";
import { parseDocument } from "./markdown.js";
import type { Catalog } from "./model.js";
import {
  collectRepositoryPaths,
  collectRepositoryPathStates,
  repositoryPathCandidates,
  type RepositoryPathState,
} from "./repository-paths.js";
import {
  collectSecurityPolicyAssetEvidence,
  type SecurityPolicyAssetEvidence,
} from "./security-policy-inventory.js";
import type {
  Artifact,
  AssetClassificationEvidence,
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
  repositoryPathStates: ReadonlyMap<string, RepositoryPathState>;
  /** Snapshot-scoped indexes reused by commands without reinterpreting files. */
  classifications: ReadonlyMap<string, AssetClassificationEvidence>;
  skillParents: SkillParentIndex;
  securityPolicies: SecurityPolicyAssetEvidence[];
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
  const skillParents = buildSkillParentIndex(documents);
  const built = buildCatalog(documents, discoveredPaths, skillParents);
  const classifications = buildClassificationEvidenceIndex(documents);
  const securityPolicies = collectSecurityPolicyAssetEvidence(
    artifacts,
    config.security,
  );
  const contextLens = summarizeContextLensGovernance(documents, built.catalog);
  const repositoryPaths = await collectRepositoryPaths(
    root,
    artifacts,
    documents,
    built.catalog,
    discoveredPaths,
  );
  const repositoryPathStates = await collectRepositoryPathStates(
    root,
    [...repositoryPaths, ...repositoryPathCandidates(documents, built.catalog)],
    artifacts,
    config,
  );

  return {
    root,
    ...(configPath ? { configPath } : {}),
    config,
    artifacts,
    documents,
    repositoryPaths,
    repositoryPathStates,
    classifications,
    skillParents,
    securityPolicies,
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
