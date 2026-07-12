import type { ConfigOverrides } from "../config.js";
import { scan } from "../scanner.js";
import type {
  TrustGraph,
  TrustGraphEdgeType,
  TrustGraphFinding,
  TrustGraphFindingSeverity,
  TrustGraphNodeType,
  TrustGraphSchema,
} from "../trust-graph.js";
import { projectTrustGraphV1 } from "../trust-graph.js";

export type TrustGraphFormat = "json" | "markdown";

const NODE_TYPES: TrustGraphNodeType[] = [
  "asset",
  "owner",
  "lifecycle_status",
  "security_profile",
  "effective_policy",
  "diagnostic",
];

const EDGE_TYPES: TrustGraphEdgeType[] = [
  "owned_by",
  "has_lifecycle_status",
  "declares_dependency",
  "references",
  "owns_local_resource",
  "statically_references",
  "inherits_owner",
  "selects_security_profile",
  "inherits_policy",
  "has_effective_policy",
  "has_diagnostic",
];

const REVIEW_SEVERITY_ORDER: TrustGraphFindingSeverity[] = [
  "error",
  "critical",
  "high",
  "medium",
  "warning",
  "low",
  "info",
];

export async function runTrustGraphCommand(
  targetPath: string,
  options: {
    format: TrustGraphFormat;
    overrides?: ConfigOverrides;
    schema?: TrustGraphSchema;
  },
): Promise<number> {
  const graph = await trustGraph(
    targetPath,
    options.overrides ?? {},
    options.schema ?? "v2",
  );
  process.stdout.write(formatTrustGraph(graph, options.format));
  return 0;
}

export async function trustGraph(
  targetPath: string,
  overrides: ConfigOverrides = {},
  schema: TrustGraphSchema = "v2",
): Promise<TrustGraph> {
  const result = await scan(targetPath, overrides);
  if (!result.trustGraph) {
    throw new Error("scan did not produce Trust Graph evidence.");
  }
  return schema === "v1"
    ? projectTrustGraphV1(result.trustGraph)
    : result.trustGraph;
}

export function formatTrustGraphJson(graph: TrustGraph): string {
  return `${JSON.stringify(graph, null, 2)}\n`;
}

export function formatTrustGraphMarkdown(graph: TrustGraph): string {
  const lines = [
    "# Renma Trust Graph",
    "",
    `- Schema: ${graph.schemaVersion}`,
    `- Assets: ${graph.summary.assetCount}`,
    `- Nodes: ${graph.summary.nodeCount}`,
    `- Edges: ${graph.summary.edgeCount}`,
    `- Findings: ${graph.summary.findingCount}`,
    "",
    "## Node Counts",
    "",
    "| Type | Count |",
    "| --- | ---: |",
    ...NODE_TYPES.map(
      (type) => `| ${type} | ${graph.summary.nodeTypeCounts[type]} |`,
    ),
    "",
    "## Edge Counts",
    "",
    "| Type | Count |",
    "| --- | ---: |",
    ...EDGE_TYPES.map(
      (type) => `| ${type} | ${graph.summary.edgeTypeCounts[type]} |`,
    ),
    "",
    "## Trust Evidence Highlights",
    "",
    `- Owned assets: ${graph.summary.edgeTypeCounts.owned_by}/${graph.summary.assetCount}`,
    `- Assets with lifecycle status: ${graph.summary.edgeTypeCounts.has_lifecycle_status}/${graph.summary.assetCount}`,
    `- Selected security profiles: ${graph.summary.edgeTypeCounts.selects_security_profile}`,
    `- Effective policy fingerprints: ${graph.summary.nodeTypeCounts.effective_policy}`,
    `- Diagnostics linked to assets: ${graph.summary.edgeTypeCounts.has_diagnostic}`,
    "",
    "## Finding Severity Counts",
    "",
    "| Severity | Count |",
    "| --- | ---: |",
    `| error | ${graph.summary.findingSeverityCounts.error} |`,
    `| warning | ${graph.summary.findingSeverityCounts.warning} |`,
    `| info | ${graph.summary.findingSeverityCounts.info} |`,
    `| critical | ${graph.summary.findingSeverityCounts.critical} |`,
    `| high | ${graph.summary.findingSeverityCounts.high} |`,
    `| medium | ${graph.summary.findingSeverityCounts.medium} |`,
    `| low | ${graph.summary.findingSeverityCounts.low} |`,
    "",
    "## Finding Risk Class Counts",
    "",
    "| Risk Class | Count |",
    "| --- | ---: |",
    `| violation | ${graph.summary.riskClassCounts.violation} |`,
    `| suspicious | ${graph.summary.riskClassCounts.suspicious} |`,
    `| advisory | ${graph.summary.riskClassCounts.advisory} |`,
    `| unclassified | ${graph.summary.riskClassCounts.unclassified} |`,
    "",
    "## Top Findings",
    "",
  ];

  const topFindings = [...graph.findings]
    .sort(compareFindingsForReview)
    .slice(0, 20);
  if (topFindings.length === 0) {
    lines.push("- (none)");
  } else {
    for (const finding of topFindings) {
      const identifier = finding.id ?? finding.code ?? finding.source;
      const risk = finding.riskClass ? ` [${finding.riskClass}]` : "";
      const path = finding.path ? ` ${finding.path}` : "";
      lines.push(
        `- ${finding.severity}${risk} ${identifier}${path}: ${singleLine(finding.message)}`,
      );
    }
  }

  return `${lines.join("\n")}\n`;
}

function formatTrustGraph(graph: TrustGraph, format: TrustGraphFormat): string {
  if (format === "json") return formatTrustGraphJson(graph);
  return formatTrustGraphMarkdown(graph);
}

function compareFindingsForReview(
  left: TrustGraphFinding,
  right: TrustGraphFinding,
): number {
  const bySeverity =
    REVIEW_SEVERITY_ORDER.indexOf(left.severity) -
    REVIEW_SEVERITY_ORDER.indexOf(right.severity);
  if (bySeverity !== 0) return bySeverity;
  const byPath = (left.path ?? "").localeCompare(right.path ?? "");
  if (byPath !== 0) return byPath;
  const byLine =
    (left.evidence?.startLine ?? 0) - (right.evidence?.startLine ?? 0);
  if (byLine !== 0) return byLine;
  return (
    (left.id ?? left.code ?? "").localeCompare(right.id ?? right.code ?? "") ||
    left.message.localeCompare(right.message)
  );
}

function singleLine(value: string): string {
  return value.replace(/\r?\n/g, " ");
}
