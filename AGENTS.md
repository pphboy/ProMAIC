# ProMAIC maintenance

ProMAIC is a Windows desktop course player derived from
https://github.com/THU-MAIC/OpenMAIC. The primary flow is importing and playing
OpenMAIC `.maic.zip` courses. SQLite and local files hold durable data; only
explicit user AI operations may call configured AI APIs.

## Maintain the fork's main branch

The maintained repository is https://github.com/pphboy/ProMAIC, and `main` is
its LocalFirst development and delivery branch. The user has explicitly
requested direct maintenance of this branch.

- Start ordinary maintenance from an up-to-date `main`. Complete authorized
  changes with a commit and push to `origin/main`; do not leave completed work
  only on a feature branch.
- Use temporary branches when needed for isolation or upstream review, then
  integrate the reviewed result into `main` without discarding other work.
- Preserve shared history. Do not force-push `main`; if upstream integration
  requires rewriting it, obtain separate authorization as described below.
- LocalFirst behavior and this fork's README take precedence when adapting
  upstream features or documentation.

## Keep the local contract

- Preserve the upstream document and archive formats, validators, and public
  storage contracts. Keep local adapters separate and changes focused to reduce
  rebase conflicts. Do not mass-rename or format unrelated upstream code.
- Never restore mandatory PostgreSQL, S3, cloud authentication, CDN requests,
  web search, or cloud parsing in the default local player.
- Package Windows runtime dependencies. Do not require end users to install
  Node.js or Docker. Keep user data outside the installation directory and
  preserve it on upgrade. Verify native modules using the packaged runtime.
- Run real SQLite persistence/migration tests and disconnected ZIP playback
  tests for relevant changes. PGlite tests cannot establish SQLite correctness.
- A feature unavailable locally must be gated and reported honestly. Do not
  mark a deferred implementation or untested Windows artifact as complete.

## Proactively track upstream

At the beginning of maintenance, inspect Git status and remotes and check
upstream differences when network access is available. Do not replace an
existing remote with a different URL. Configure `upstream` as
`https://github.com/THU-MAIC/OpenMAIC` if absent, and discover its default branch
rather than assuming a branch name. If offline, record that checking was not
possible and continue work that does not depend on it.

Use rebase as the primary upstream integration method. See
[the synchronization procedure](.github/UPSTREAM_SYNC.md) for concrete commands.
Check on maintenance tasks; this instruction does not create a scheduled job
or require a real rebase on every edit.

Before rebasing, require a clean worktree, preserve user changes, create a
recovery reference, and work on a temporary synchronization branch. Never
discard uncommitted files or automatically force-push a shared branch. Obtain
separate authorization if integration requires rewriting shared history.

When upstream adds a feature or fix, port its data and resource dependencies
to the local backend. Resolve conflicts by preserving both the upstream fix
and the local contract. Record any feature deferred with its reason and
remaining work; do not present that feature as synchronized. For example, an
upstream feature using JSONB needs equivalent local persistence and contract
tests, or explicit capability gating and a recorded deferral, never a hidden
PostgreSQL fallback.

Each synchronization record must include the source/default branch, previous
and new upstream SHAs, local before/after SHAs, adopted/deferred features,
conflict decisions, and test commands/results. Verify SQLite upgrades, course
CRUD, ZIP import/playback, local media, no non-AI public network access, optional
AI, and Windows packaging as affected. Do not claim completion while required
checks are missing.
