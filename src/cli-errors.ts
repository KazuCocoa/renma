import { ConfigError } from "./config.js";

/** Stable process exit codes exposed by the Renma CLI. */
export const CLI_EXIT = {
  success: 0,
  policyFailure: 1,
  userError: 2,
  internalError: 3,
} as const;

/** A caller-correctable invocation, configuration, target, or input error. */
export class CliUserError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CliUserError";
  }
}

export interface ClassifiedCliError {
  exitCode: typeof CLI_EXIT.userError | typeof CLI_EXIT.internalError;
  message: string;
}

/** Classify command exceptions without treating arbitrary failures as usage errors. */
export function classifyCliError(error: unknown): ClassifiedCliError {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof ConfigError || error instanceof CliUserError) {
    return { exitCode: CLI_EXIT.userError, message };
  }
  return {
    exitCode: CLI_EXIT.internalError,
    message: `Renma internal error: ${message}`,
  };
}
