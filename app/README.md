# 核心播放器应用开发说明

`app/` 是 Magpie Music Player 的可信核心应用，包含 Vue 前端、Pinia 状态、播放器服务、插件运行时管理和 Tauri 桌面外壳。

核心应用只提供播放器本体、插件管理和运行时隔离，不内置第三方音乐搜索、歌词搜索或歌曲信息搜索服务。

## 目录结构

```text
app/
  src/
    assets/            全局样式和静态资源。
    components/        通用组件。
    config/            应用配置、主题和官方来源列表。
    core/              播放器核心、插件管理器等运行时核心逻辑。
    services/          本地音乐扫描、缓存、插件安装、黑名单等应用服务。
    store/             Pinia 状态和持久化设置。
    types/             应用内部类型。
    utils/             通用工具方法。
    views/             播放器界面和设置界面。
  src-tauri/           Tauri 桌面端配置与 Rust 命令。
  public/              前端公开静态资源。
```

## 常用脚本

在 `app/` 目录内运行：

```bash
pnpm dev
pnpm build
pnpm build:mac
pnpm build:mac:intel
pnpm build:mac:apple
pnpm build:mac:universal
pnpm build:windows
pnpm build:windows:cross
pnpm build:linux
pnpm build:linux:cross
pnpm build:raw
pnpm web:dev
pnpm web:build
pnpm tauri
```

- `pnpm dev`：启动 Tauri 桌面开发模式。
- `pnpm build`：构建当前平台默认桌面安装包。
- `pnpm build:mac`：在 macOS 上构建 universal `.app` 和 `.dmg`，同时支持 Intel 与 Apple Silicon。
- `pnpm build:mac:intel`：在 macOS 上只构建 Intel 版 `.app` 和 `.dmg`。
- `pnpm build:mac:apple`：在 macOS 上只构建 Apple Silicon 版 `.app` 和 `.dmg`。
- `pnpm build:mac:universal`：同 `pnpm build:mac`，需要安装 `aarch64-apple-darwin` 与 `x86_64-apple-darwin` Rust targets。
- `pnpm build:windows`：在 Windows 上构建 NSIS `.exe` 和 MSI `.msi`。
- `pnpm build:windows:cross`：在 macOS/Linux 上通过 `cargo-xwin` 交叉构建 Windows x64 NSIS `.exe`，用于本地测试。
- `pnpm build:linux`：在 Linux 上构建 `.deb`、`.rpm` 和 `.AppImage`。
- `pnpm build:linux:cross`：通过 Docker 构建 Linux x64 `.deb`、`.rpm` 和 `.AppImage`，用于本地测试。
- `pnpm build:linux:cross:x64`：同 `pnpm build:linux:cross`。
- `pnpm build:raw`：只构建 Tauri release 可执行文件，不生成安装包。
- `pnpm web:dev`：只启动 Vite 开发服务。
- `pnpm web:build`：执行前端类型检查并构建 Web 产物。
- `pnpm tauri`：执行 Tauri CLI 命令。

在仓库根目录也可以运行：

```bash
pnpm web:build
pnpm build
pnpm desktop:build
```

## 桌面安装包配置

Tauri 配置分为通用配置和平台配置：

- `src-tauri/tauri.conf.json`：应用标识、通用 bundle 元数据、图标、CSP 和窗口配置。
- `src-tauri/tauri.macos.conf.json`：macOS universal `.app` 和 `.dmg` 配置。
- `src-tauri/tauri.windows.conf.json`：Windows NSIS `.exe` 与 MSI `.msi` 配置。
- `src-tauri/tauri.windows-cross.conf.json`：macOS/Linux 交叉构建 Windows x64 NSIS `.exe` 的覆盖配置。
- `src-tauri/tauri.linux.conf.json`：Linux `.deb`、`.rpm` 与 `.AppImage` 配置。

当前应用标识为 `cn.hpyer.magpie.music`。如果发布后修改该标识，系统会把应用视为不同产品，并影响数据目录和安装器升级行为。

Windows MSI 的 `upgradeCode` 已固定在 `tauri.windows.conf.json` 中，后续发布不要随意修改，否则 Windows 可能无法把新版识别为旧版升级。

Tauri 安装包通常需要在对应系统上构建。macOS runner 负责 universal `.app`/`.dmg`，Windows runner 负责 `.exe`/`.msi`，Linux runner 负责 `.deb`/`.rpm`/`.AppImage`。macOS universal 构建前需要执行 `rustup target add x86_64-apple-darwin aarch64-apple-darwin`。签名、公证和发布证书未写入仓库配置，应在 CI secret 或本机环境中配置。

`scripts/build-desktop.mjs` 会在执行平台脚本前检查当前系统，避免在 macOS 上把 `nsis`/`msi` 传给 Tauri，或在 Windows 上把 `deb`/`rpm`/`appimage` 传给 Tauri。跨平台安装包可以使用仓库根目录的 `.github/workflows/build-desktop.yml` 在三类 runner 上分别构建。

本地 Windows 交叉构建脚本 `pnpm build:windows:cross` 面向测试用途，只产出 Windows x64 NSIS `.exe`。它通过 `--config src-tauri/tauri.windows-cross.conf.json` 覆盖 bundle target，避免在 macOS/Linux 上把 `nsis` 作为命令行 `--bundles` 参数传给 Tauri。使用前需要安装 `x86_64-pc-windows-msvc` Rust target 和 `cargo-xwin`；macOS 还需要安装 LLVM 并让 `llvm-rc` 等工具进入 `PATH`。脚本会优先使用 `MAGPIE_XWIN_CACHE_DIR`，其次使用通用的 `XWIN_CACHE_DIR`；如果都没有设置，才会把 XWin SDK 缓存在 `src-tauri/target/xwin-cache`。

如果 cargo-xwin 报 `Failed to setup MSVC CRT`，并且错误指向 `https://aka.ms/vs/16/release/channel`，通常是下载微软 SDK/CRT manifest 时网络中断。换网络重试，或预先准备可用的 `MAGPIE_XWIN_CACHE_DIR` / `XWIN_CACHE_DIR` 即可。

本地 Linux 交叉构建脚本 `pnpm build:linux:cross` 面向测试用途，底层通过 Docker 运行 Linux 容器构建安装包。脚本会先检查 Docker CLI 和 Docker daemon，再使用 `docker/linux-builder.Dockerfile` 构建 `magpie-music/linux-builder:bookworm` 镜像。第一次构建会下载 Linux 系统依赖、Rust 和 pnpm，后续会复用 Docker 镜像层缓存。

Linux Docker builder 默认使用国内镜像源：

- Debian apt：`https://mirrors.tuna.tsinghua.edu.cn/debian`
- Debian security：`https://mirrors.tuna.tsinghua.edu.cn/debian-security`
- npm/pnpm：`https://registry.npmmirror.com`
- rustup dist：`https://mirrors.tuna.tsinghua.edu.cn/rustup`
- rustup update：`https://mirrors.tuna.tsinghua.edu.cn/rustup/rustup`
- Cargo crates：`sparse+https://rsproxy.cn/index/`
- Tauri AppImage 工具预下载镜像兜底：`https://mirror.ghproxy.com`

可以设置 `MAGPIE_LINUX_USE_CHINA_MIRRORS=0` 切回官方源，也可以通过 `MAGPIE_LINUX_APT_MIRROR`、`MAGPIE_LINUX_DEBIAN_SECURITY_MIRROR`、`MAGPIE_LINUX_NPM_REGISTRY`、`MAGPIE_LINUX_RUSTUP_DIST_SERVER`、`MAGPIE_LINUX_RUSTUP_UPDATE_ROOT`、`MAGPIE_LINUX_CARGO_REGISTRY`、`MAGPIE_LINUX_TAURI_TOOL_DOWNLOAD_MIRROR`、`MAGPIE_LINUX_TAURI_BUNDLER_GITHUB_MIRROR` 和 `MAGPIE_LINUX_TAURI_BUNDLER_GITHUB_MIRROR_TEMPLATE` 单独覆盖。

基础镜像默认仍是 `node:22-bookworm`，镜像拉取速度取决于本机 Docker registry mirror 配置。也可以通过 `MAGPIE_LINUX_NODE_IMAGE` 指向自建镜像或可用的镜像代理。

AppImage 依赖的 Tauri bundler 工具会在构建前预下载到 `/root/.cache/tauri`，下载时使用 `curl --retry` 自动重试，并在成功后写入 marker，后续构建复用缓存。预下载默认先尝试官方 GitHub 地址，再使用镜像兜底；可以设置 `MAGPIE_LINUX_TAURI_TOOL_DOWNLOAD_RETRIES` 调整每个地址的重试次数，也可以设置 `MAGPIE_LINUX_PREFETCH_TAURI_TOOLS=0` 关闭预下载。

容器每次仍然是一次性的，但 pnpm 包、Cargo 包和 Rust 编译中间产物会保存在 Docker volume 中复用：

- `magpie-music-linux-pnpm-store`
- `magpie-music-linux-cargo-registry`
- `magpie-music-linux-cargo-git`
- `magpie-music-linux-target-x86_64_linux`
- `magpie-music-linux-tauri-cache`

构建时不会直接在宿主机工作区内安装 Linux `node_modules`，而是把源码复制到容器内部构建，完成后只把 bundle 产物复制回本项目目录。

Linux Docker 构建产物路径：

- x64：`src-tauri/target/x86_64_linux/release/bundle`

## 核心职责

核心播放器负责：

- 本地音乐目录扫描和播放列表管理。
- 音频播放、进度、音量、循环和随机播放。
- 歌曲封面、歌词、元数据和缓存目录管理。
- 插件包安装、启用、禁用、删除和配置渲染。
- 插件权限提示、运行时调用和结果归一化。
- 插件黑名单拉取、签名校验和本地匹配。

插件不应被直接导入 `app/src`。主应用只通过安装后的插件包、插件清单和运行时消息与插件交互。

## 本地数据与隐私

核心应用默认不上传用户数据。以下数据保存在用户设备本地：

- 应用设置、主题、快捷键、缓存配置和插件配置。
- 播放列表、本地目录记录、收藏歌曲和播放会话。
- 已安装插件记录、插件包文件哈希、插件黑名单缓存。
- 封面、歌词、远程媒体缓存和其他媒体资源缓存。

设置、播放列表等 JSON 数据通过 `app/src/store/appFileStorage.ts` 写入 AppData 目录，并使用应用本地 AES-GCM 密钥加密。密钥同样保存在 AppData 目录，用于防止配置文件被直接明文读取；它不能替代操作系统账号隔离、磁盘加密或用户对设备本身的保护。

应用可能产生的网络请求主要来自：

- 用户启用的插件访问其 `networkAllowlist` 声明的服务。
- 插件黑名单服务拉取公开签名列表和签名文件。
- 用户手动播放或缓存远程媒体时访问对应媒体地址。

黑名单检查只下载公开列表并在本地比较，不上传插件列表、媒体库、播放记录、本地路径或插件配置。

## 插件运行时边界

主应用通过插件管理器加载已安装插件，并向插件发送统一的 `handleMessage(message)` 消息。核心应用会根据插件声明的能力把消息路由到播放列表、音乐搜索、歌词搜索、歌曲信息搜索或媒体地址解析流程。

主应用不会信任插件返回的歌曲来源。插件返回的 `MediaItem.sourceId`、专辑来源和歌手来源都会被宿主改写为当前插件 id，用于缓存判断、权限边界和责任划分。

远程媒体缓存由来源白名单控制：

- 官方来源 id 维护在应用代码中。
- 用户可在插件列表里为第三方歌曲搜索插件开启“允许缓存后播放”。
- 用户配置默认不包含任何第三方来源。
- 本地歌曲不经过远程缓存逻辑。

## 插件黑名单

应用可以从远程地址拉取签名黑名单，校验通过后缓存在本地。黑名单可以按插件 id、签名者 id、插件包哈希、入口文件哈希或网络来源匹配。

仓库根目录的 `plugin-blocklist/` 是当前托管的黑名单目录，列表文件为 `plugin-blocklist/blocklist.json`。列表为空时仍应保留合法 JSON 结构：`version: 1`、`updatedAt` 和 `entries: []`。正式启用远程黑名单时，需要同时发布对应签名文件，默认签名地址为 `<blocklist-url>.sig`。

应用会优先拉取 Gitee 镜像地址，再用 GitHub raw 地址兜底。两个远程地址都加载失败时，应用会继续使用本地已缓存且通过签名校验的黑名单；如果没有缓存，则不阻塞播放器启动。加载失败保持静默，只有当新的插件被黑名单匹配并自动禁用时，才提示用户。

黑名单检查只拉取公开静态文件，并在本地完成比较。应用不会上传已安装插件列表、插件配置、媒体库、播放记录或其他用户隐私数据。

如果远程黑名单无法获取或验签失败，应用会继续使用上一次通过验签的缓存；如果没有缓存，则不阻塞本地播放器启动。

## 开发注意事项

- 新增设置项时，需要在默认设置、归一化、克隆和持久化逻辑中同时处理。
- 新增插件消息或能力时，需要同步更新 `packages/plugin-types`、插件 CLI 校验、插件模板和插件开发文档。
- 涉及网络访问时，应确认是否需要权限提示、`networkAllowlist` 校验和隐私说明。
- 涉及缓存或本地文件写入时，应确认来源字段、缓存白名单和用户可清理路径是否完整。
- 涉及第三方内容来源时，不应把具体第三方搜索服务内置到核心播放器。

## 验证建议

常规变更建议在仓库根目录执行：

```bash
pnpm build
```

只改播放器前端时可以先执行：

```bash
pnpm --filter magpie-music-player web:build
```

涉及 Tauri 配置或 Rust 侧能力时，建议额外执行：

```bash
pnpm --filter magpie-music-player build:raw
```
