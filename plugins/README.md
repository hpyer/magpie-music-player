# 插件开发说明

`plugins/` 用来放官方开源插件和插件项目模板。插件源码由 pnpm workspace 管理，但插件运行时必须独立打包、安装和加载，核心播放器不会直接导入这里的插件源码。

## 目录内容

```text
plugins/
  navidrome/       Navidrome/Subsonic 兼容播放列表来源插件。
  template-ts/     TypeScript 插件基础模板。
  template-js/     JavaScript 插件基础模板。
```

当前官方插件：

- `navidrome`：连接 Navidrome 或兼容 Subsonic API 的服务，提供远程播放列表、媒体地址解析、封面读取和歌词读取能力。

官方插件列表统一维护在：

```text
plugins/official-plugins.json
```

该文件面向根目录 README 和发布流程使用。新增官方插件时，需要在列表中补充插件 id、目录、版本、描述、release 文件名，以及 GitHub/Gitee 两个下载地址。

模板：

- `template-ts`：空 TypeScript 插件项目模板，默认引入 `@magpie-music/plugin-types`。
- `template-js`：空 JavaScript 插件项目模板。

## 基本规则

- 插件代码不能被核心播放器直接 import。
- 插件公共类型统一从 `@magpie-music/plugin-types` 获取。
- 插件必须以 `.zip` 包发布，包根目录需要包含 `plugin.json`。
- 插件安装后存放在用户应用数据目录，而不是 `app/src`。
- 依赖第三方音乐、歌词、封面或元数据服务的插件应由插件作者独立发布，并自行承担内容来源合规责任。

## CLI

插件 CLI 包名是 `@magpie-music/plugin-cli`，命令名是 `magpie-music`。

```bash
magpie-music create my-plugin --ts
magpie-music create my-plugin --js
magpie-music create my-plugin --template <git-url>
magpie-music test
magpie-music build
```

- `magpie-music create <name> --ts`：创建 TypeScript 插件项目。
- `magpie-music create <name> --js`：创建 JavaScript 插件项目。
- `magpie-music create <name> --template <git-url>`：从自定义 Git 仓库创建插件项目。
- `magpie-music test [plugin-dir]`：构建插件并校验入口模块和安装配置消息。
- `magpie-music build [plugin-dir]`：构建插件、更新入口文件哈希并生成发布 zip。

默认模板来源会先尝试：

```text
https://gitee.com/Hpyer/magpie-music-player.git
```

失败后再尝试：

```text
https://github.com/hpyer/magpie-music-player.git
```

自定义模板仓库可以包含以下任意结构：

- `plugins/template-ts`
- `plugins/template-js`
- 根目录 `template-ts`
- 根目录 `template-js`
- 仓库根目录就是模板

## 插件包格式

推荐发布格式：

```text
my-plugin-1.0.0.zip
  plugin.json
  dist/index.js
  assets/
  SIGNATURE
```

`plugin.json` 是安装契约，声明插件身份、入口、权限、能力和完整性信息。发布包应该包含构建产物，而不是只包含源码。源码可以单独公开，方便审计。

安装器也可以接受只有一个顶层目录的 zip，只要该顶层目录内包含 `plugin.json`。

## 插件清单

示例 `plugin.json`：

```json
{
  "schemaVersion": 1,
  "id": "com.example.metadata",
  "name": "Example Metadata Provider",
  "version": "1.0.0",
  "runtime": "web-worker-esm",
  "entry": "dist/index.js",
  "permissions": ["media:metadata", "network:request"],
  "capabilities": ["song-info-search"],
  "networkAllowlist": ["https://api.example.com"],
  "integrity": {
    "algorithm": "sha256",
    "entry": "replace-with-release-artifact-hash",
    "signature": "replace-with-release-signature",
    "signer": "replace-with-developer-key-id"
  }
}
```

公共类型定义在 `packages/plugin-types`。插件项目应从 `@magpie-music/plugin-types` 引入 `PluginManifest`、`PluginMessage`、`MediaItem`、`SearchResult` 等类型。

## 统一消息入口

插件只需要导出一个运行时入口：

```ts
import type { PluginMessage } from '@magpie-music/plugin-types';

export async function handleMessage(message: PluginMessage) {
  switch (message.type) {
    case 'installation.config-schema':
      return { fields: [] };
    case 'runtime.initialize':
      return { ok: true };
    case 'playlist.list':
      return [];
    default:
      throw new Error(`Unsupported message: ${message.type}`);
  }
}
```

主应用会通过这个方法处理安装配置、运行时初始化和能力调用。插件内部可以拆分私有函数，但对外导出的运行时契约保持 `handleMessage(message)`。

## 配置表单

插件安装时，主应用会发送：

```ts
{ type: 'installation.config-schema' }
```

插件返回配置字段：

```ts
export async function handleMessage(message: PluginMessage) {
  if (message.type === 'installation.config-schema') {
    return {
      fields: [
        {
          key: 'apiUrl',
          label: 'API 地址',
          type: 'url',
          placeholder: 'https://api.example.com',
          required: true
        }
      ]
    };
  }
}
```

主应用会保存字段列表，在插件设置面板渲染配置表单，并在启用插件前校验必填项。

## 权限说明

插件应只声明自己确实需要的权限：

- `network:request`：访问网络。插件应同时声明 `networkAllowlist`。
- `media:playlist`：读取远程播放列表。
- `media:search`：搜索网络媒体。
- `media:resolve-url`：解析媒体播放地址。
- `media:lyrics`：搜索歌词或按媒体读取歌词。
- `media:metadata`：读取或更新歌曲元数据。
- `media:cover`：读取或更新封面。
- `media:delete`：删除远程媒体。
- `cache:write`：请求写入媒体缓存。
- `storage:plugin`：使用插件私有存储。
- `ui:panel`：提供自定义界面面板。

如果插件声明了 `network:request`，应把上游服务域名写入 `networkAllowlist`。主应用会基于该列表限制网络来源，并在安装或启用时向用户展示相关信息。

## 能力与消息

### 播放列表来源

适用于 Navidrome 这类用户自有或授权服务。插件负责认证和远程 API，主应用负责展示列表、保存播放列表引用和播放。

清单能力与权限：

```json
{
  "capabilities": ["playlist-source", "media-url", "media-lyrics", "media-cover"],
  "permissions": ["media:playlist", "media:resolve-url", "media:lyrics", "media:cover", "network:request"]
}
```

消息：

```ts
type PlaylistSourceMessage =
  | { type: 'playlist.list' }
  | { type: 'playlist.songs'; playlistId: string };
```

### 音乐搜索

适用于用户授权的网络音乐来源。核心项目不提供通用第三方音乐搜索插件，也不把该能力包装成下载器。

清单能力与权限：

```json
{
  "capabilities": ["music-search", "media-url"],
  "permissions": ["media:search", "media:resolve-url", "network:request"]
}
```

消息：

```ts
type MusicSearchMessage = {
  type: 'music.search';
  query: string;
  page: number;
  limit: number;
};
```

### 媒体资源读取

适用于远程播放列表或搜索结果里的媒体资源补全。

清单能力与权限：

```json
{
  "capabilities": ["media-url", "media-lyrics", "media-cover"],
  "permissions": ["media:resolve-url", "media:lyrics", "media:cover"]
}
```

```ts
type MediaResourceMessage =
  | { type: 'media.url'; mediaId: string }
  | { type: 'media.lyric'; mediaId: string }
  | { type: 'media.cover'; mediaId: string };
```

### 歌词搜索

适用于歌词来源插件。插件作者需要确保歌词来源合法或经过用户授权。

清单能力与权限：

```json
{
  "capabilities": ["lyrics-search"],
  "permissions": ["media:lyrics", "network:request"]
}
```

消息：

```ts
type LyricsSearchMessage =
  | { type: 'lyrics.search'; context: LyricSearchContext }
  | { type: 'lyrics.get'; lyricId: string; context: LyricSearchContext };
```

### 歌曲信息搜索

适用于元数据和封面来源插件。插件作者需要确保数据来源合法或经过用户授权。

清单能力与权限：

```json
{
  "capabilities": ["song-info-search"],
  "permissions": ["media:metadata", "media:cover", "network:request"]
}
```

消息：

```ts
type SongInfoSearchMessage =
  | { type: 'song-info.search'; context: SongInfoSearchContext }
  | { type: 'song-info.get'; songInfoId: string; context: SongInfoSearchContext };
```

## 来源与缓存

每个 `MediaItem` 都有 `sourceId`。本地歌曲使用主应用内置本地来源 id；插件返回的歌曲、专辑和歌手来源会被主应用强制改写为当前插件 id。

远程媒体缓存由来源白名单控制：

- 官方来源 id 在应用代码里维护。
- 用户可在插件列表中为第三方歌曲搜索插件开启“允许缓存后播放”。
- 用户配置默认不包含任何第三方来源。
- 未进入白名单的第三方插件歌曲直接播放，不缓存后播放。

这套规则用于把缓存行为绑定到明确来源，避免第三方搜索插件隐式把播放器变成下载工具。

## 插件隐私要求

插件作者需要遵守以下约束：

- 不收集与插件功能无关的数据。
- 不上传用户本地路径、媒体库列表、播放记录或已安装插件列表。
- 不绕过主应用的权限提示、网络来源限制和缓存白名单。
- 不把用户凭据写入日志、错误信息、远程查询参数或可公开访问的地址。
- 需要访问第三方服务时，应在插件说明中写清楚访问的服务、用途和可能发送的数据。
- 对歌词、封面、元数据和媒体结果，应说明数据来源，并确保来源合法或经过用户授权。

插件可以在自身说明文档中补充单独的隐私说明。涉及账号、令牌、服务地址或用户媒体库信息的插件，应特别说明这些配置只用于连接用户指定的服务。

## 哈希与打包

`integrity.entry` 是 `entry` 指向文件的 SHA-256 哈希。

开发时推荐使用：

```bash
pnpm --filter @magpie-music/plugin-cli build
magpie-music create my-plugin --ts --dir plugins/my-plugin
cd plugins/my-plugin
pnpm test
pnpm build
```

`pnpm build` 会构建插件、更新 `plugin.json` 中的入口哈希，并生成：

```text
release/<plugin-id>-<version>.zip
```

官方插件的 release zip 需要纳入 git 管理。模板、第三方插件和临时开发插件的 release 产物不需要提交。

安装时，主应用会记录插件包 SHA-256，以及每个已安装文件的 SHA-256。启动或启用插件时会按记录的哈希表验证已安装文件，而不是信任当前磁盘上的 `plugin.json`。如果校验失败，插件会被禁用并提示用户。

## 加载流程

1. 用户选择插件 zip 包。
2. 主应用解包到临时目录。
3. 主应用解析并校验 `plugin.json`。
4. 主应用校验入口文件和安装文件哈希。
5. 主应用展示插件请求的能力和权限。
6. 主应用把插件安装到用户应用数据目录。
7. 主应用启动插件运行时。
8. 插件通过窄接口消息与主应用交互。

## 安全与责任

插件应该显式声明权限和网络来源。高风险权限应由主应用提示用户确认，网络请求应经过主应用代理并受 `networkAllowlist` 限制。

第三方插件由插件作者独立发布，使用者需要自行确认其合规性。本项目不托管、不索引、不推荐未经授权的媒体、歌词、封面或元数据来源。如果收到关于第三方插件的投诉，项目维护者可以通过签名远程黑名单阻止相关插件继续加载。

## 发布前检查

插件发布前建议确认：

- `plugin.json` 中的 `id`、`name`、`version`、`capabilities`、`permissions` 和 `networkAllowlist` 准确。
- `handleMessage(message)` 支持插件声明能力对应的消息。
- `installation.config-schema` 返回 `{ fields: [...] }`。
- `pnpm test` 能通过入口模块和配置 schema 校验。
- `pnpm build` 能更新入口哈希并生成 zip。
- README 已说明插件用途、配置项、访问的第三方服务、数据来源和隐私边界。
