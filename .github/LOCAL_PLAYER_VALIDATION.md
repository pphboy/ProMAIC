# Local player validation

Recorded on 2026-10-10 for the working tree based on
`8c3a90d5535d22d01a042635d7285221e61d15f1`.

## Completed

- Production Next.js build on Linux and Windows x64 with frozen pnpm install.
- Real SQLite initialization, checksummed migrations, rollback, bounded locks,
  document/runtime contracts, settings, media references and backup/restore.
- Existing PostgreSQL document/runtime/asset contracts: 3 suites, 214 tests
  passed using the upstream package test configuration.
- Minimum Node 22.19 SQLite probe and bundled Electron 44.7.0 runtime probe.
- `pnpm desktop:smoke:browser`: real browser ZIP import, audio/video decoding and
  seeking, interactive scene, quiz answer, service restart and retained records.
  Both browser and server public networking were blocked and monitored.
- `pnpm desktop:smoke:ai`: explicit calls to a local mock AI endpoint, local
  conversation history across restart, and continued course access on AI outage.
- Native Linux packaged window: independent backend, sandboxed renderer,
  local ZIP import/open, and local listener shutdown on exit.
- `pnpm exec tsc --noEmit --incremental false` passed. Full `pnpm lint`
  passed with 0 errors and 19 warnings; generated desktop output is excluded.
- Final focused run: 13 test files and 105 tests passed, including a relocation
  regression that deletes the original pnpm source before loading staged modules.
  An earlier broader related run passed 18 suites and 207 tests.

## Windows build

The source was installed and built natively using Windows Node 24.14.1 and the
project-pinned pnpm 10.28.0. The Windows build workspace is
`C:\Users\p\AppData\Local\Temp\promaic-win-build-0dctd608\source`.
Run `pnpm desktop:dist`; installers are under `dist\desktop`. The final
local repackage used `--config.directories.output=dist/desktop-final`; the
repackaged executable passed the native Windows classroom-rendering smoke.
The delivered installer is `dist/desktop/ProMAIC-1.2.0-rc.1-windows-x64-setup.exe`
in the Linux workspace, with an adjacent SHA-256 checksum.

Initial desktop launch exposed missing packaged dependencies. Staging now
materializes pnpm sibling dependencies and Turbopack aliases, prefers traced
copies over Windows workspace junctions, explicitly includes Next route
runtimes omitted by Windows tracing, and the builder copies runtime modules. Older installers produced before these
fixes must not be distributed.

## Pending acceptance

Native Windows x64 packaged-window startup, local ZIP import, Chinese/space
profile paths, retained courses across restart, and listener shutdown passed.
The app PATH was limited to Windows system directories; the test harness still
used development Node. A genuinely clean-machine install, full Windows media
acceptance, and installer upgrade acceptance remain pending. A successful build or
Linux playback does not establish Windows acceptance. Docker image startup and
the complete legacy/broken-course cross-module acceptance are also pending.
