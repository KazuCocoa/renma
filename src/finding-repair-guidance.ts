import type {
  Finding,
  RepairConstraint,
  VerificationStep,
} from "./types/diagnostics.js";

interface CanonicalFindingRepairGuidance {
  repairConstraints?: RepairConstraint[];
  verificationSteps?: VerificationStep[];
}

interface FindingCompatibilityGuidance {
  legacyRepairConstraints?: RepairConstraint[];
  legacyVerificationSteps?: VerificationStep[];
  repairConstraints?: RepairConstraint[];
  verificationStepsV2?: VerificationStep[];
}

const CANONICAL_FINDING_REPAIR_GUIDANCE = Symbol(
  "renma.canonicalFindingRepairGuidance",
);

type FindingWithCanonicalGuidance = Finding & {
  [CANONICAL_FINDING_REPAIR_GUIDANCE]?: CanonicalFindingRepairGuidance;
};

/**
 * Project canonical typed Finding guidance into the legacy text fields.
 *
 * Production Finding authors provide only `repairConstraints` and
 * `verificationStepsV2`. The returned Finding retains those typed values as
 * non-enumerable internal authority while exposing the legacy text arrays in
 * their established enumerable positions.
 */
export function projectFindingRepairGuidance(
  finding: Finding,
  compatibility: FindingCompatibilityGuidance = {},
): Finding {
  const alreadyProjected = canonicalFindingRepairGuidance(finding);
  if (alreadyProjected) return finding;
  if (finding.constraints || finding.verificationSteps) {
    throw new Error(
      `Finding ${finding.id} authored legacy repair guidance instead of typed guidance.`,
    );
  }

  const canonical: CanonicalFindingRepairGuidance = {
    ...(finding.repairConstraints
      ? { repairConstraints: [...finding.repairConstraints] }
      : {}),
    ...(finding.verificationStepsV2
      ? {
          verificationSteps: finding.verificationStepsV2.map((step) =>
            completeVerificationStep(step, finding.id),
          ),
        }
      : {}),
  };
  const result = {} as FindingWithCanonicalGuidance;
  const canonicalKeys = new Set(["repairConstraints", "verificationStepsV2"]);
  const entries = Object.entries(finding);
  let compatibilityAppended = false;

  for (const [index, [key, value]] of entries.entries()) {
    if (key === "repairConstraints") {
      const legacyConstraints = (
        compatibility.legacyRepairConstraints ?? canonical.repairConstraints
      )?.map((constraint) => constraint.text);
      if (legacyConstraints) result.constraints = legacyConstraints;
    } else if (key === "verificationStepsV2") {
      const legacySteps = (
        compatibility.legacyVerificationSteps ?? canonical.verificationSteps
      )?.map((step) => step.text);
      if (legacySteps) result.verificationSteps = legacySteps;
    } else {
      Object.defineProperty(result, key, {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }

    const nextKey = entries[index + 1]?.[0];
    if (
      canonicalKeys.has(key) &&
      !canonicalKeys.has(nextKey ?? "") &&
      !compatibilityAppended
    ) {
      appendCompatibilityGuidance(result, compatibility);
      compatibilityAppended = true;
    }
  }

  if (!compatibilityAppended) {
    appendCompatibilityGuidance(result, compatibility);
  }

  Object.defineProperty(result, CANONICAL_FINDING_REPAIR_GUIDANCE, {
    value: canonical,
  });
  if (!compatibility.repairConstraints && canonical.repairConstraints) {
    Object.defineProperty(result, "repairConstraints", {
      value: canonical.repairConstraints,
      configurable: true,
      writable: true,
    });
  }
  if (!compatibility.verificationStepsV2 && canonical.verificationSteps) {
    Object.defineProperty(result, "verificationStepsV2", {
      value: canonical.verificationSteps,
      configurable: true,
      writable: true,
    });
  }
  return result;
}

/** Return the canonical typed guidance without consulting legacy prose. */
export function canonicalFindingRepairGuidance(
  finding: Finding,
): CanonicalFindingRepairGuidance | undefined {
  return (finding as FindingWithCanonicalGuidance)[
    CANONICAL_FINDING_REPAIR_GUIDANCE
  ];
}

/** Copy a Finding while preserving its non-enumerable typed guidance. */
export function copyFindingWith(
  finding: Finding,
  overrides: Partial<Finding>,
): Finding {
  const copy = Object.defineProperties(
    {},
    Object.getOwnPropertyDescriptors(finding),
  ) as Finding;
  return Object.assign(copy, overrides);
}

function appendCompatibilityGuidance(
  finding: Finding,
  compatibility: FindingCompatibilityGuidance,
): void {
  if (compatibility.repairConstraints) {
    finding.repairConstraints = compatibility.repairConstraints;
  }
  if (compatibility.verificationStepsV2) {
    finding.verificationStepsV2 = compatibility.verificationStepsV2;
  }
}

function completeVerificationStep(
  step: VerificationStep,
  code: string,
): VerificationStep {
  if (step.command !== "renma scan" || step.expected !== undefined) {
    return { ...step };
  }
  return {
    ...step,
    expected: `No diagnostics with code ${code} are reported.`,
  };
}
