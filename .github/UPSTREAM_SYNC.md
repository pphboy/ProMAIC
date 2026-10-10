# Upstream synchronization

Run checks during repository maintenance; do not run a background updater.
The source is https://github.com/THU-MAIC/OpenMAIC and the fork remains `origin`.
These commands are a maintenance procedure, not an instruction to rebase during
the initial local-player implementation.

Inspect the worktree and remotes first:

```bash
git status --short --branch
git remote -v
git ls-remote --symref https://github.com/THU-MAIC/OpenMAIC HEAD
```

Only if absent, add the remote. If it exists with a different URL, investigate
instead of replacing it. Fetch and discover its default branch:

```bash
git remote add upstream https://github.com/THU-MAIC/OpenMAIC
git fetch upstream
git remote set-head upstream --auto
git symbolic-ref --short refs/remotes/upstream/HEAD
git log --oneline HEAD..upstream/HEAD
git diff --stat HEAD...upstream/HEAD
```

The last diff shows changes since the merge base. Inspect the corresponding
commits and changelog before integration. Preserve dirty user work and stop the
rebase step until the tree is clean. Do not automatically stash or delete it.

Choose unused names for a recovery reference and a temporary branch, recording
the actual values and SHAs. The example names below must not overwrite existing
references:

```bash
git rev-parse HEAD
git rev-parse upstream/HEAD
git branch recovery/before-upstream-sync
git switch -c sync/upstream-review
git rebase upstream/HEAD
```

Resolve each conflict by retaining applicable upstream features/fixes and
adapting storage, media, and runtime dependencies locally. Inspect SQL and
external-resource changes explicitly. Use `git rebase --continue` after review
or `git rebase --abort` to return the temporary branch to its pre-rebase state.
The recovery reference still names the original local history. No force push
is part of this procedure. Shared-history replacement requires separate user
authorization; present the reviewed result and required action first.

Validate the resulting branch before integrating it. Run affected SQLite
migrations/storage, library, ZIP import, media seek/deletion, disconnected
browser playback, and optional AI tests, plus lint/type/build and Windows
packaging checks. Keep the existing PostgreSQL contract tests where those paths
changed. Record actual outcomes and outstanding Windows/manual checks.

Use this record in the synchronization PR or maintenance report:

```text
Upstream URL/default branch:
Previous upstream SHA:
New upstream SHA:
Local before SHA/recovery reference:
Local after SHA/review branch:
Adopted features and fixes:
Deferred features, reasons, capability gates and follow-up work:
Conflict decisions and local adaptations:
Verification commands and results:
Windows packaged-runtime/install/upgrade results:
Remaining checks and integration authorization (if needed):
```
