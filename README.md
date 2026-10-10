# ProMAIC · LocalFirst

English | [简体中文](README-zh.md) · [Windows downloads](https://github.com/pphboy/ProMAIC/releases) · [Desktop build](desktop/README.md)

**An OpenMAIC course player centered on local playback.** Install the Windows app, import a `.maic.zip` course, and learn on your own computer. Courses, media, learner records, and model settings stay locally. Runtime activity stays on your machine except for AI API calls you explicitly request.

## LocalFirst principles

- **Start learning before configuring AI.** Importing, opening, navigating, playing packaged media, and answering quizzes require no account or AI key.
- **Keep data local.** SQLite stores courses and learner records, and local files hold media. Personal use needs no PostgreSQL, S3, or cloud identity service.
- **Run offline after installation.** The Windows app bundles its runtime, player resources, and supported interactive dependencies. Users need no Node.js, Docker, or separately installed browser.
- **Use the network only for requested AI operations.** Basic playback does not invoke online speech generation, search, cloud parsing, or telemetry. External course resources missing from the package are blocked and reported.
- **Adapt upstream features to local use.** New features must support SQLite and local resources before being offered in the local player.

## Install and use on Windows

1. Download a Windows x64 installer from [Releases](https://github.com/pphboy/ProMAIC/releases). The current prerelease is [player-v1.2.0-rc.1](https://github.com/pphboy/ProMAIC/releases/tag/player-v1.2.0-rc.1), with an `.exe` installer and SHA-256 checksum.
2. Install and open ProMAIC to enter the local course library.
3. Click **Import course package** (导入课程包) and select a `.maic.zip` exported by OpenMAIC.
4. Open the course to play, navigate, or answer quizzes. Configure a model and API in settings when you want classroom AI.

The current installer is an unsigned prerelease. Closing the desktop app stops its bundled local service.

## Current capabilities

| Capability | Local behavior |
| --- | --- |
| Course library and folders | Import, browse, search, rename, move, and delete courses |
| ZIP import | Use OpenMAIC formatVersion 1 with remapped course and media references |
| Slides and media | Display course content, play packaged audio/video, and seek |
| Interactives and quizzes | Use supported interactive scenes and save learner records |
| Restart recovery | Read saved courses, media, and durable learner records after reopening |
| Optional classroom AI | Call configured AI APIs through the local backend and keep settings and supported conversation records locally |

Course generation, the Agent workbench, and cloud-dependent processing have not been ported to local mode. Their entry points are gated by capability.

## Courses that work offline

The supported input is an **OpenMAIC `.maic.zip` course package**, rather than an arbitrary ZIP of documents. It should contain a supported manifest, scenes, actions, and required media.

- Complete course packages can be imported and played. Unsupported versions, unsafe paths, or missing required indexed media are rejected.
- Scenes without narration remain readable and navigable without an automatic online TTS request.
- Some known interactive dependencies in older packages resolve to bundled resources. Unresolved images, scripts, fonts, and other resources are reported while unaffected content remains playable.
- The app does not download missing course resources. Prepare a complete package with the media and interactive resources needed for offline use.

To move courses from an existing PostgreSQL installation, export ZIP courses there and import them into the local player. Automatic conversion of historical PostgreSQL databases is not provided.

## Local data and backups

Windows desktop course data normally lives at:

```text
%APPDATA%\ProMAIC\data
```

This directory holds the `openmaic.sqlite` database, media, and local files needed to read saved secrets. It is separate from the installation directory and retained on upgrade.

Close the app before backing up, then copy the **entire data directory**, including SQLite WAL/SHM files when present. Restore the complete backup with the app stopped and use a compatible application version. Copying only the database file is insufficient. See [local storage and backup](.github/LOCAL_STORAGE.md).

For source-based runs, set an absolute `OPENMAIC_DATA_DIR` to choose a directory. The source server defaults to `%LOCALAPPDATA%\ProMAIC\data` on Windows and `~/ProMAIC/data` elsewhere. The desktop app uses its own user data directory; set an absolute `OPENMAIC_DESKTOP_PROFILE_DIR` to choose a separate desktop profile and course library.

## Source development

Node.js 24 is recommended, with 22.19 as the minimum. The repository pins pnpm 10.28.0 through `packageManager`.

```bash
git clone --branch main https://github.com/pphboy/ProMAIC.git
cd ProMAIC
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:3000` for the local course library. Basic playback needs no model configuration file, AI key, or database server.

Dependency installation and build resource preparation may use the internet. Prepared desktop builds run offline. If reusing an older configuration, remove `DATABASE_URL` and `ASSET_S3_BUCKET` for local mode. Explicit PostgreSQL configuration retains a compatibility path; SQLite is the local default.

### Build the Windows installer

Run on Windows x64:

```powershell
pnpm install --frozen-lockfile
pnpm desktop:dist
```

The installer is written to:

```text
dist/desktop/ProMAIC-<version>-windows-x64-setup.exe
```

Prepare native dependencies on Windows. See [desktop documentation](desktop/README.md) for development, packaging, and profile configuration. The [Windows workflow](.github/workflows/windows-player.yml) covers storage, playback, installation, and upgrade checks. The published RC has a [successful Windows CI run](https://github.com/pphboy/ProMAIC/actions/runs/38020525866).

## Origin and maintenance

ProMAIC is based on [THU-MAIC/OpenMAIC](https://github.com/THU-MAIC/OpenMAIC), retaining its course model, ZIP format, and relevant validation contracts. Thanks to the upstream team and contributors.

**This repository's LocalFirst scope and configuration take precedence.** Upstream generation-platform, online-service, and PostgreSQL deployment documentation is reference material. This README and the [desktop guide](desktop/README.md) describe the local player.

The maintained development and delivery branch is `main` in `pphboy/ProMAIC`.

Maintenance proactively checks upstream changes and uses rebase as the primary synchronization method. Features must be adapted to SQLite and local resource constraints; unported features are recorded explicitly. See [AGENTS.md](AGENTS.md), the [upstream synchronization procedure](.github/UPSTREAM_SYNC.md), and [OpenSpec implementation tasks](openspec/changes/local-course-player-sqlite/tasks.md).

## License

The project uses the [MIT License](LICENSE). Third-party components retain their own terms, including:

- `packages/mathml2omml`: [LGPL-3.0-or-later](packages/mathml2omml/LICENSE).
- `packages/pptxgenjs`: [MIT](packages/pptxgenjs/package.json).

Other bundled dependencies and resources retain their corresponding license notices.
