export { analyzeSecurityCommand } from "./analyze.js";
export {
  associatedFailClosedVariableGuardNames,
  explicitNoDisclosureGuards,
  failClosedVariableGuardNames,
  isExplicitNoDisclosureGuard,
} from "./guards.js";
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
