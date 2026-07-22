import { classifyAssetPath } from "../discovery.js";
import { parseAssetMetadata } from "../metadata.js";
import type { AssetClassificationEvidence } from "../types/classification.js";
import type { ParsedDocument } from "../types/metadata.js";

/** Build the structural classification view shared by snapshot consumers. */
export function buildClassificationEvidenceIndex(
  documents: ParsedDocument[],
): ReadonlyMap<string, AssetClassificationEvidence> {
  return new Map(
    documents.map((document) => {
      const metadata = parseAssetMetadata(document).metadata;
      return [
        document.artifact.path,
        classifyAssetPath(document.artifact.path, {
          ...(metadata.type ? { metadataType: metadata.type } : {}),
        }),
      ];
    }),
  );
}
