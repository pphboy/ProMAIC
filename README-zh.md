# ProMAIC · LocalFirst

[English](README.md) | 简体中文 · [Windows 下载](https://github.com/pphboy/ProMAIC/releases) · [桌面构建](desktop/README.md)

**以本地播放为中心的 OpenMAIC 课程播放器。** 下载 Windows 程序，导入 `.maic.zip` 课程包，即可在自己的电脑上学习。课程、媒体、学习记录和模型设置保存在本机；除用户主动使用的 AI API 外，运行过程全部在本地完成。

## LocalFirst 原则

- **先播放，再按需配置 AI。** 导入、打开、翻页、播放包内音视频和答题不需要账号或 AI 密钥。
- **数据留在本机。** SQLite 保存课程和学习记录，本地文件保存媒体；个人使用无需 PostgreSQL、S3 或云身份服务。
- **安装后可离线使用。** Windows 桌面包内置运行时、播放器资源和受支持的互动依赖，使用者无需安装 Node.js、Docker 或额外浏览器。
- **网络仅用于主动请求的 AI。** 基础播放不调用在线语音生成、搜索、云解析或遥测；课程中的未包含外部资源会被阻止并提示。
- **本地能力优先。** 后续吸收上游功能时，先适配 SQLite 和本地资源约束，再作为本地功能提供。

## Windows 安装与使用

1. 从 [Releases](https://github.com/pphboy/ProMAIC/releases) 下载 Windows x64 安装包。当前预发布为 [player-v1.2.0-rc.1](https://github.com/pphboy/ProMAIC/releases/tag/player-v1.2.0-rc.1)，附件包含 `.exe` 和 SHA-256 校验文件。
2. 安装并打开 ProMAIC，进入本地课程库。
3. 点击 **导入课程包**，选择 OpenMAIC 导出的 `.maic.zip`。
4. 打开课程，播放、切换场景或答题。需要课堂 AI 时，再在设置中配置模型与 API。

当前安装包为未签名的预发布版本。退出桌面窗口会关闭内置本地服务。

## 当前功能

| 功能 | 本地行为 |
| --- | --- |
| 课程库与文件夹 | 导入、浏览、搜索、重命名、移动和删除课程 |
| ZIP 课程导入 | 沿用 OpenMAIC formatVersion 1，重映射课程及媒体引用 |
| 幻灯片与媒体 | 显示课程内容，播放包内音视频，支持播放位置拖动 |
| 互动与测验 | 使用受支持的互动场景，保存答题与学习记录 |
| 重启恢复 | 再次打开应用后，课程、媒体和持久学习记录仍可读取 |
| 可选课堂 AI | 由本机后端调用已配置的 AI API，本地保存配置和支持的会话记录 |

课程生成、Agent 工作台和依赖云端的处理流程尚未迁入本地模式，对应入口按能力关闭。

## 什么课程包可以离线播放

支持的是 OpenMAIC 导出的 **`.maic.zip` 课程包**，并非任意 ZIP 文档合集。课程包应包含受支持的 manifest、场景、动作和必需媒体。

- 完整课程包可以直接导入和播放；不支持的版本、不安全路径或缺失的必需索引媒体会拒绝导入。
- 没有旁白时可继续阅读和切换场景，不会自动请求在线 TTS。
- 旧包引用的部分已知互动依赖可以映射到内置资源；无法在本地解析的图片、脚本、字体等会显示缺失提示，其他内容仍可播放。
- 应用不会联网下载旧包的缺失资源。离线使用前，应先准备包含所需媒体及互动资源的完整课程包。

从旧 PostgreSQL 安装迁入时，请先在原应用导出课程 ZIP，再导入本地版。目前不提供 PostgreSQL 历史数据库的自动转换。

## 本地数据与备份

Windows 桌面版的课程数据通常位于：

```text
%APPDATA%\ProMAIC\data
```

该目录包含 SQLite 数据库 `openmaic.sqlite`、媒体和读取已保存密钥所需的本地文件，独立于程序安装目录。升级保留用户数据。

备份时先退出应用，再复制**整个数据目录**，包括存在的 SQLite WAL/SHM 文件。恢复时关闭应用，将完整备份放回，并使用兼容的应用版本；不要只复制单个数据库文件。详见 [本地存储与备份说明](.github/LOCAL_STORAGE.md)。

源码运行可用绝对路径 `OPENMAIC_DATA_DIR` 指定数据目录；Windows 源码服务默认使用 `%LOCALAPPDATA%\ProMAIC\data`，其他平台默认使用 `~/ProMAIC/data`。桌面版使用自己的用户数据目录；需要独立课程库时，可用绝对路径 `OPENMAIC_DESKTOP_PROFILE_DIR` 指定整个桌面用户目录。

## 源码开发

建议使用 Node.js 24，最低要求为 22.19；pnpm 版本按仓库 `packageManager` 固定为 10.28.0。

```bash
git clone --branch main https://github.com/pphboy/ProMAIC.git
cd ProMAIC
pnpm install --frozen-lockfile
pnpm dev
```

打开 `http://127.0.0.1:3000` 即可进入本地课程库。基础播放无需复制模型配置文件、填写 AI 密钥或启动数据库。

依赖安装和构建资源准备可以联网；准备好的桌面产物可离线运行。如果沿用旧配置，请移除本地模式中的 `DATABASE_URL` 和 `ASSET_S3_BUCKET`。显式 PostgreSQL 配置仍保留兼容路径，本地默认配置以 SQLite 为准。

### 构建 Windows 安装包

在 Windows x64 上执行：

```powershell
pnpm install --frozen-lockfile
pnpm desktop:dist
```

产物位于：

```text
dist/desktop/ProMAIC-<version>-windows-x64-setup.exe
```

原生依赖需要在 Windows 上准备。桌面开发、打包和用户目录配置见 [桌面版本说明](desktop/README.md)。[Windows 构建工作流](.github/workflows/windows-player.yml)覆盖存储、播放、安装和升级检查；已发布 RC 的 [Windows CI 结果](https://github.com/pphboy/ProMAIC/actions/runs/38020525866)可供查阅。

## 项目来源与维护

ProMAIC 基于 [THU-MAIC/OpenMAIC](https://github.com/THU-MAIC/OpenMAIC)，保留上游课程模型、ZIP 格式和相关验证契约。感谢上游团队及贡献者。

**本仓库以 LocalFirst 的功能范围和配置为准。** 上游的生成平台、在线服务与 PostgreSQL 部署文档用于参考；本地播放器的使用入口是本页及 [桌面说明](desktop/README.md)。

日常开发与交付直接维护 `pphboy/ProMAIC` 的 `main` 分支。

维护时主动检查上游变化，以 rebase 为主要同步方式；新功能必须适配 SQLite 和本地资源边界，未适配功能明确记录。具体规则见 [AGENTS.md](AGENTS.md) 与 [上游同步流程](.github/UPSTREAM_SYNC.md)。实施进度见 [OpenSpec 任务](openspec/changes/local-course-player-sqlite/tasks.md)。

## 许可证

项目采用 [MIT License](LICENSE)。第三方组件保留各自协议，包括：

- `packages/mathml2omml`：[LGPL-3.0-or-later](packages/mathml2omml/LICENSE)。
- `packages/pptxgenjs`：[MIT](packages/pptxgenjs/package.json)。

其他内置依赖和资源的授权声明随对应包或分发资源保留。
