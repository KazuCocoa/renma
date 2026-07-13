# Trust Graph v2 Contract

Renma 0.18.0 emits only `renma.trustGraph.v2`, the first supported long-term
Trust Graph contract. The authoritative machine-readable definition is the
[Trust Graph v2 JSON Schema](schemas/trust-graph-v2.schema.json).

The required top-level fields are `schemaVersion`, `summary`, `nodes`, `edges`,
and `findings`. Node `properties` and node and edge `evidence` are optional.
Edge `properties` are optional except where an edge-specific provenance rule
requires them. Finding identity fields (`code`, `id`, `title`, `riskClass`,
`path`, and `evidence`) appear only when supplied. Missing optional fields are
omitted, not serialized as `null`.

Nodes are ordered by type and stable ID; edges by source, type, target, and ID;
findings by deterministic review order. Summary maps contain all enum members.
Asset nodes include normalized ownership and first-class support evidence.
Static support uses `owns_local_resource`, `statically_references`,
`inherits_owner`, and `inherits_policy`. Every `owned_by` edge declares
`ownershipSource`; when its value is `inherited`, the edge also retains an
`inheritedFrom` object with the owning asset ID and source path. Every
`has_effective_policy` edge has a non-empty, duplicate-free `policySources`
array. Its values are limited to `local`, `security_profile`,
`repository_config`, and `owning_skill`, in that generated order. Effective
policy inherited from an owning Skill retains `inheritedFrom`.

Representative complete top-level document:

```json
{
  "schemaVersion": "renma.trustGraph.v2",
  "summary": {
    "assetCount": 0, "nodeCount": 0, "edgeCount": 0, "findingCount": 0,
    "nodeTypeCounts": { "asset": 0, "owner": 0, "lifecycle_status": 0, "security_profile": 0, "effective_policy": 0, "diagnostic": 0 },
    "edgeTypeCounts": { "owned_by": 0, "has_lifecycle_status": 0, "declares_dependency": 0, "references": 0, "owns_local_resource": 0, "statically_references": 0, "inherits_owner": 0, "selects_security_profile": 0, "inherits_policy": 0, "has_effective_policy": 0, "has_diagnostic": 0 },
    "findingSeverityCounts": { "critical": 0, "high": 0, "medium": 0, "low": 0, "error": 0, "warning": 0, "info": 0 },
    "riskClassCounts": { "violation": 0, "suspicious": 0, "advisory": 0, "unclassified": 0 }
  },
  "nodes": [],
  "edges": [],
  "findings": []
}
```

Within v2, evolution is additive and backward-compatible. Removing or changing
an existing field requires a new schema version. Enum additions are
consumer-visible and must be documented.
