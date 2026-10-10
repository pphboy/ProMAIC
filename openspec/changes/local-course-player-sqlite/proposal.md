# Proposal

## Why

ProMAIC 的主要用途是本地导入和播放 OpenMAIC ZIP 课程包，但当前 1.2 服务端架构强制依赖 PostgreSQL，课程内外部资源也可能要求公网访问。需要一个除用户主动启用的 AI API 外全部在本机运行的版本，同时继续吸收上游功能和修复。

## What Changes

- 以 Windows x64 独立桌面程序为主要交付，使用 Electron 内置窗口和运行时，提供安装程序；用户无需安装 Node.js、Docker 或数据库。程序退出时回收本地服务，升级保留用户数据。

- 新增默认本地播放模式：Windows 独立桌面窗口连接随程序内置的本机 Node.js 服务，无需 PostgreSQL、S3、云身份服务或 AI 密钥即可启动、导入和播放课程。
- 使用 SQLite 持久化课程、文件夹、学习记录、必要会话和模型配置，媒体字节保存在本地数据目录；保持现有 ZIP 格式及课程模型。
- 内置播放器所需脚本、字体和样式，导入时检查课程外部依赖；缺失资源明确提示，播放和导入均不自动访问公网补齐。
- AI 对话作为可选功能，通过本机后端调用显式配置的 AI API；基础播放不触发生成、搜索、云解析或在线语音服务。
- 调整启动检查、配置和部署文档，使 SQLite 成为个人本地安装的默认后端；保留 PostgreSQL 实现供上游兼容和回归参考，不在本地模式加载或连接它。
- 在实施阶段新增根目录 `AGENTS.md`，规定主动检查 `THU-MAIC/OpenMAIC`、以 rebase 同步新功能并维护 SQLite/本地运行契约的流程。

## Capabilities

### New Capabilities

- `local-sqlite-persistence`: 本地数据库初始化、迁移、课程和学习数据持久化、文件媒体生命周期及可选 AI 会话存储。
- `local-course-playback`: ZIP 导入和本地课程库、离线资源处理、持久播放与可选 AI API 边界。
- `upstream-sync-policy`: 仓库级上游跟踪、rebase、功能适配与回归验证规则。

### Modified Capabilities

无。项目目前没有主规格。

## Impact

- 涉及 `lib/import/use-import-classroom.ts`、课程库和课堂播放界面、`lib/document-store/`、`lib/persistence/`、`@openmaic/storage` 及相关 API 路由。
- 涉及 `instrumentation.ts`、`lib/config/feature-flags.ts`、身份单用户配置、模型配置和课堂 AI 会话入口。
- 涉及本地资源打包、互动场景资源策略、Next.js 构建、环境变量、Compose、README 和新增 `AGENTS.md`。
- 增加 SQLite 运行依赖或受支持 Node.js 内置绑定及本地文件字节后端，增加真实 SQLite 和阻断公网的集成测试。
- 本次不承诺 PostgreSQL 历史库自动迁移、多人协作、无人值守同步服务，或完整迁移课程生成/工作台。旧数据以 ZIP 导入为主要迁移路径。
