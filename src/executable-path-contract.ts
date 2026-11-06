/** Shared bounded executable suffixes; these identify files, never permissions. */
export const LEGACY_HELPER_EXTENSION =
  /\.(?:mjs|js|cjs|ts|mts|cts|sh|bash|py)$/u;
export const POWERSHELL_HELPER_EXTENSION = /\.ps1$/iu;
export const BATCH_HELPER_EXTENSION = /\.(?:bat|cmd)$/iu;

export function hasSupportedHelperExtension(candidate: string): boolean {
  return (
    LEGACY_HELPER_EXTENSION.test(candidate) ||
    POWERSHELL_HELPER_EXTENSION.test(candidate) ||
    BATCH_HELPER_EXTENSION.test(candidate)
  );
}

/** Context and Lens roots share file-based executable discovery; parent resolution is separate. */
export function isGovernedRepositoryScriptPath(candidate: string): boolean {
  return (
    /^(?:contexts|lenses)\//u.test(candidate) &&
    (hasSupportedHelperExtension(candidate) ||
      (/\/scripts\/.+/u.test(candidate) &&
        !/(?:^|\/)(?:[^/]+\.)?mdx?$/iu.test(candidate)))
  );
}

export const GOVERNED_REPOSITORY_SCRIPT_GLOBS = ["contexts", "lenses"].flatMap(
  (root) => [
    `${root}/**/scripts/**/*`,
    `${root}/**/*.{mjs,js,cjs,ts,mts,cts,sh,bash,py}`,
    `${root}/**/*.[pP][sS]1`,
    `${root}/**/*.{[bB][aA][tT],[cC][mM][dD]}`,
  ],
);
