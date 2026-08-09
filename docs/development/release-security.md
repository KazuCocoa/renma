# Release Publication Security

Renma publishes npm releases only from `.github/workflows/npm-publish.yml`.
The repository and external service configuration form one trust boundary; the
repository-visible checks are necessary release evidence, but are not a
complete authorization boundary by themselves.

## Repository-visible checks

Before the workflow enters its OIDC-enabled publish job,
`tools/verify-release-tag.mjs` fetches the exact triggering tag object and
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
