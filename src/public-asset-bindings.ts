/** Read-only, snapshot-based asset binding contract for external builders. */
import { compareUtf16CodeUnits as order } from "./canonical-json.js";
import { createHash } from "node:crypto";
import { buildCatalog } from "./catalog.js";
import {
  classifyAssetPath,
  normalizeAssetRepositoryRelativePath,
} from "./discovery.js";
import { parseDocument } from "./markdown.js";
import { parseRenmaFrontmatter } from "./yaml-frontmatter.js";
import type {
  AssetBindingFile,
  AssetBindingReport,
} from "./types/asset-bindings.js";
export type {
  AssetBindingFile,
  BindingAssetKind,
  BindingRelationshipKind,
  AssetBindingLocation,
  AssetBindingIdentity,
  AssetBindingRelationship,
  AssetBindingReference,
  AssetBindingDiagnostic,
  NormalizedAssetBinding,
  AssetBindingSatisfaction,
  AssetBindingDocument,
  AssetBindingReport,
} from "./types/asset-bindings.js";
export { compareAssetBinding } from "./asset-binding-analysis.js";
/** Inspect one caller-supplied repository snapshot without filesystem access or mutation. */
export function inspectAssetBindings(
  files: readonly AssetBindingFile[],
): AssetBindingReport {
  const paths = new Set<string>();
  const documents = [...files]
    .sort((a, b) => order(a.path, b.path))
    .map((file) => {
      if (
        normalizeAssetRepositoryRelativePath(file.path) !== file.path ||
        paths.has(file.path)
      )
        throw new Error(
          `Expected a unique normalized repository-relative path: ${file.path}`,
        );
      paths.add(file.path);
      const content = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(file.bytes);
      const type = parseRenmaFrontmatter(content).values.type;
      const classification = classifyAssetPath(
        file.path,
        typeof type === "string" ? { metadataType: type } : {},
      );
      return parseDocument({
        path: file.path,
        absolutePath: file.path,
        kind: classification.kind,
        content,
        sizeBytes: file.bytes.byteLength,
        contentHash: createHash("sha256").update(file.bytes).digest("hex"),
        contentClassification: "text",
        markdownParserEligible: /\.md$/iu.test(file.path),
      });
    });
  return buildCatalog(documents).assetBindings;
}
