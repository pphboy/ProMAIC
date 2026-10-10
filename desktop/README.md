# Windows desktop player

The desktop target is an independent Electron window with a bundled local
backend. End users do not install Node.js, Docker, or PostgreSQL. SQLite, local media, ZIP import, and classroom playback are included. See
[recorded validation](../.github/LOCAL_PLAYER_VALIDATION.md) for tested behavior
and remaining acceptance checks.

Build on Windows x64, using Node 24 and the repository's pinned pnpm version:

```powershell
pnpm install --frozen-lockfile
pnpm desktop:dist
```

The unsigned NSIS installer is staged under `dist/desktop/`, named
`ProMAIC-<version>-windows-x64-setup.exe`. Installer signing is not configured.
The `Windows player` workflow provides a Windows build runner when manually
triggered or when a `player-v*` tag is pushed. It uploads a build artifact, not
a published release. A successful build must still undergo the acceptance
checks below before being described as ready for users.

The desktop app packages `.next/standalone`, `.next/static`, and `public` as
resources and starts the backend in an Electron utility process. It binds an
OS-selected loopback port and opens a sandboxed window after readiness. Closing
the last window requests shutdown and then terminates an unresponsive backend
after a bounded wait. Renderer requests stay on the local origin; AI calls must
go through the backend.

Data is under `app.getPath('userData')/data`, typically
`%APPDATA%\ProMAIC\data` on Windows. Upgrades retain this directory. Do not put
databases or API keys inside installation resources. The default installer is
per-user and does not request administrator elevation.

For development after a production build:

```powershell
pnpm build
pnpm desktop:stage
pnpm desktop:dev
```

Do not stage Linux `node_modules` into a Windows installer: native dependencies
must be selected and built on the target platform. Verify `node:sqlite` in the
actual Electron runtime, not only in the development Node process. Staging
materializes traced pnpm dependencies and Turbopack aliases without junctions,
including nested conflicting versions, so installation paths remain relocatable.

For isolated testing, set `OPENMAIC_DESKTOP_PROFILE_DIR` to an absolute directory.
This overrides Electron userData without changing the normal user library.

Acceptance requires a Windows machine without development runtimes: install
and launch; import a mixed-scene course package; play packaged audio/video and
seek; answer a quiz; restart and verify persistence; confirm no non-AI public
network requests; test Chinese/space-containing paths; upgrade without losing
data; close and check that the local listener has stopped. Missing external
resources in old course packages must be clearly diagnosed. Record these
results separately from Linux or lifecycle unit-test results.
