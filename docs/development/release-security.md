# Release Publication Security

Renma publishes npm releases only from `.github/workflows/npm-publish.yml`.
The repository and external service configuration form one trust boundary; the
repository-visible checks are necessary release evidence, but are not a
complete authorization boundary by themselves.

## Repository-visible checks

Before the workflow enters its OIDC-enabled publish job,
`scripts/verify-release-tag.mjs` fetches the exact triggering tag object and
`origin/main` from `origin`. It does not rely on checkout depth or a pre-existing
local tag. The verifier requires a stable annotated version tag, recursively
peels it to a commit, binds it to the checked-out workflow commit, requires
exact equality with `origin/main`, and then requires the tag version to equal
`package.json`. Exact equality intentionally rejects tagged commits ahead of,
behind, or beside main; ancestry is not enough.

The publish job also depends on successful tests, builds, and package checks at
both the minimum supported Node version and the current LTS version. It is bound
to the `npm-publish` GitHub Environment and is the only npm workflow job with
`id-token: write`.

These same-workflow checks are not sufficient against an attacker who can
modify and push the tagged workflow commit. Such a commit could modify or remove
repository-controlled verification before requesting an OIDC token.

## Non-blocking development-toolchain risk

Audit date: 2026-08-17.

`npm audit --omit=dev` reports no known production vulnerabilities under the
current lockfile. The full development audit reports two moderate and one high
package results in the VitePress-only documentation toolchain: VitePress
`1.6.4` resolves Vite `5.4.21`, which resolves esbuild `0.21.5`. The inherited
advisory set is:

- [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99):
  esbuild development-server cross-origin response exposure, patched in
  esbuild `0.25.0`.
- [GHSA-4w7w-66w2-5vf9](https://github.com/advisories/GHSA-4w7w-66w2-5vf9):
  Vite optimized-dependency source-map path traversal, patched on the Vite 6
  line in `6.4.2`.
- [GHSA-v6wh-96g9-6wx3](https://github.com/advisories/GHSA-v6wh-96g9-6wx3):
  Windows UNC-path handling through `launch-editor`, patched on the Vite 6 line
  in `6.4.3`.
- [GHSA-fx2h-pf6j-xcff](https://github.com/advisories/GHSA-fx2h-pf6j-xcff):
  Windows alternate-path bypass of Vite's `server.fs.deny`, patched on the
  Vite 6 line in `6.4.3`.

These transitive version matches do not establish that every vulnerable code
path is reachable through VitePress. The two Vite path-traversal advisories
depend on an attacker being able to reach a running development server, so
preventing untrusted network access is an effective mitigation for those
advisories. The Windows `launch-editor` advisory is different: an
attacker-controlled web page can send a request from the browser to the
middleware on a localhost Vite development server. Binding that server to
localhost, or merely avoiding intentionally supplied untrusted input, does not
prevent that browser-triggered attack.

The stable VitePress release remains `1.6.4` and declares Vite `^5.4.14`, so
`npm audit` reports `fixAvailable: false`; no supported stable upgrade can move
this repository to the patched Vite and esbuild lines. VitePress
`2.0.0-alpha.19` uses a newer Vite line but is an incompatible prerelease major
and is not an acceptable forced override for release preparation. Recheck the
stable VitePress release and the full and production-only audits before 1.0.0;
adopt the first supported stable upgrade that clears the advisories and passes
the full repository validation suite.

Until then, treat this as a non-blocking local documentation-tooling risk. Do
not expose the VitePress/Vite development server to untrusted networks; this
addresses the network-exposure-dependent Vite path-traversal advisories. Prefer
`npm run docs:build`, which exits without leaving a development server running.
On Windows, avoid running `npm run docs:dev` while browsing untrusted content,
and disable NTLM where organizational policy permits. Upgrade to the first
supported stable VitePress version containing the fixes. Production package
publication is not blocked solely by these development-only audit results.

`npm run docs:build` also succeeds while the bundled Vite/esbuild version warns
that the TypeScript `ES2024` target is unrecognized. This is a docs-build
compatibility warning rather than a TypeScript build failure; retain the
project's supported compiler target and remove the warning through a supported
VitePress upgrade instead of an incompatible dependency override.

## Required external controls

Maintainers must configure and preserve all of the following outside this
repository:

1. Configure the npm package's GitHub Actions Trusted Publisher for this exact
   repository, the exact workflow filename `npm-publish.yml`, and the
   `npm-publish` environment.
2. Protect the GitHub Environment named `npm-publish` with required reviewers
   and deployment branch/tag rules that admit only the intended protected
   release tags.
3. Protect release-tag creation with a GitHub repository ruleset targeting
   `v*`, limiting who or what may create those tags and preventing unreviewed
   release refs from bypassing the publication gate.

The environment is part of npm's expected OIDC identity. Removing
`environment: npm-publish` from a modified workflow must cause npm trusted
publishing to reject that workflow's OIDC identity; it must not create an
alternate publication path.

Repository code can verify Git objects, workflow structure, tests, and package
metadata. It cannot verify that npm Trusted Publisher settings, GitHub
Environment protection, required reviewers, deployment ref rules, or tag
rulesets are configured correctly. Maintainers must audit those external
settings in their respective service interfaces.
