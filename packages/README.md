# npm 包说明

`packages/` 存放可独立发布到 npm 的公共包。它们服务于插件生态，不依赖核心播放器应用的运行时代码。

## 目录内容

```text
packages/
  plugin-types/      插件与主应用共享的 TypeScript 类型包。
  plugin-cli/        插件创建、测试和打包 CLI。
```

## @magpie-music/plugin-types

`@magpie-music/plugin-types` 提供插件清单、插件消息、媒体项目、搜索结果、配置表单等公共 TypeScript 类型。

插件项目应从该包导入公开类型：

```ts
import type { PluginManifest, PluginMessage } from '@magpie-music/plugin-types';
```

构建：

```bash
pnpm --filter @magpie-music/plugin-types build
```

## @magpie-music/plugin-cli

`@magpie-music/plugin-cli` 提供 `magpie-music` 命令，用于创建、测试和打包插件。

常用命令：

```bash
magpie-music create my-plugin --ts
magpie-music create my-plugin --js
magpie-music test
magpie-music build
```

构建：

```bash
pnpm --filter @magpie-music/plugin-cli build
```

`plugin-cli` 依赖 `plugin-types`。发布前应先确保 `@magpie-music/plugin-types` 的版本已经发布，或在同一次发布流程中先发布 `plugin-types`，再发布 `plugin-cli`。

## 发布约定

完整发布步骤请以 [发布流程](../RELEASE.md) 为准。

两个包都可以单独发布：

```bash
pnpm -C packages/plugin-types publish --access public
pnpm -C packages/plugin-cli publish --access public
```

仓库提供 GitHub Actions workflow：

```text
.github/workflows/publish-npm-packages.yml
```

该 workflow 支持手动选择发布：

- `plugin-types`
- `plugin-cli`
- `both`

也支持通过 tag 触发单包发布：

```bash
git tag plugin-types-v1.0.0
git push github plugin-types-v1.0.0
```

```bash
git tag plugin-cli-v1.0.0
git push github plugin-cli-v1.0.0
```

tag 版本必须和对应 `package.json` 中的 `version` 一致。

## 包内容

两个包都只发布构建产物和必要元数据：

- `dist/`
- `LICENSE`
- `package.json`

`prepack` 会在 `pnpm pack` 或 `pnpm publish` 前自动执行构建，避免发布缺少 `dist` 的包。

## 维护注意事项

- 修改插件协议时，先更新 `plugin-types`。
- 修改 CLI 创建、测试或打包行为时，同步检查 `plugins/template-ts`、`plugins/template-js` 和 `plugins/README.md`。
- `plugin-cli` 的 `bin` 入口需要保留 `#!/usr/bin/env node`。
- npm 包使用 MIT 许可，独立于核心播放器应用的 AGPLv3 许可。
