export { analyzeSecurityCommand } from "./analyze.js";
export {
  associatedFailClosedVariableGuardNames,
  executableFailClosedVariableGuardNames,
  explicitNoDisclosureGuards,
  hasPositiveDisclosureAction,
  isExplicitNoDisclosureGuard,
  positiveDisclosureActions,
} from "./guards.js";
export type { DisclosureAction, DisclosureActionKind } from "./guards.js";
export type {
  DependencyInstallAnalysis,
  DependencyPinningKind,
  SecurityCommandAnalysis,
  SecurityCommandInput,
  SecurityCommandSupport,
  SecuritySourceEvidence,
  SensitiveSinkAnalysis,
  SensitiveSinkKind,
  SensitiveSourceAnalysis,
  SensitiveSourceKind,
} from "./types.js";
