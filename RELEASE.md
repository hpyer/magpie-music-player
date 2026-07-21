# 发布流程

本项目按三个发布单元分别管理版本和发布流程：

- 桌面应用：`magpie-music-player`
- 插件 CLI：`@magpie-music/plugin-cli`
- 插件类型包：`@magpie-music/plugin-types`

三个发布单元可以独立发版。只有在插件协议、CLI 行为和桌面应用同时变更时，才需要组合发布。

官方插件列表维护在 `plugins/official-plugins.json`，每个官方插件的 release zip 存放在对应目录的 `release/` 目录并纳入 git 管理。官方插件包通过仓库文件下载，不随桌面应用 GitHub Release 重复上传。

发布变动统一记录在根目录 `CHANGELOG.md`。每次发布前，应根据 git 历史整理对应版本的变动内容。桌面应用发布到 GitHub Release 时，会读取 `CHANGELOG.md` 中对应版本的段落作为 Release notes。

## 仓库和 CI 前置条件

Git remote：

- `github` 指向 `https://github.com/hpyer/magpie-music-player.git`
- `gitee` 指向 `https://gitee.com/Hpyer/magpie-music-player.git`

GitHub Actions：

- `Build desktop installers` 需要 `contents: write` 权限，用于创建 GitHub Release。
- `Publish npm packages` 需要仓库 secret `NPM_TOKEN`，用于发布 npm 包。
- npm provenance 依赖 `id-token: write` 权限，workflow 已配置。

桌面安装包签名、公证和证书不写入仓库。需要正式签名时，应通过 GitHub Secrets 或本机安全环境配置。

## 发布前通用检查

确认当前工作区干净，且目标分支已经同步：

```bash
git status --short
git pull github main
```

安装依赖并运行基础构建：

```bash
pnpm install --frozen-lockfile
pnpm build
```

如果官方插件有变更，确认官方插件包已经重新生成：

```bash
pnpm --filter @magpie-music/plugin-types build
pnpm --filter @magpie-music/plugin-cli build
pnpm plugins:build
```

官方插件包应出现在：

```text
plugins/<plugin-name>/release/*.zip
```

涉及 CLI 时额外运行：

```bash
pnpm --filter @magpie-music/plugin-cli test
```

涉及黑名单签名、公钥或默认黑名单地址时，额外验证：

```bash
node plugin-blocklist/sign.mjs verify --public-key app/src/config/pluginBlocklistPublicKey.json
```

整理当前版本变动历史：

```bash
git log --oneline <previous-tag>..HEAD
```

根据历史更新 `CHANGELOG.md`。桌面应用版本标题必须使用：

```text
## v1.2.0 - YYYY-MM-DD
```

否则 GitHub Release workflow 无法提取对应版本的发布说明。

## 版本规则

### 桌面应用

桌面应用发布版本由以下文件共同表示，发布前必须保持一致：

```text
package.json
app/package.json
app/src-tauri/Cargo.toml
```

例如发布 `1.2.0` 时，上面三个文件中的版本都应为 `1.2.0`，Git tag 使用：

```text
v1.2.0
```

`.github/workflows/build-desktop.yml` 会校验 tag、根 `package.json`、`app/package.json` 和 `app/src-tauri/Cargo.toml` 是否一致。

### @magpie-music/plugin-types

版本只看：

```text
packages/plugin-types/package.json
```

发布 tag 使用：

```text
plugin-types-v1.2.0
```

`.github/workflows/publish-npm-packages.yml` 会校验 tag 是否等于该包的 `package.json` 版本。

### @magpie-music/plugin-cli

版本只看：

```text
packages/plugin-cli/package.json
```

发布 tag 使用：

```text
plugin-cli-v1.2.0
```

`plugin-cli` 依赖 `plugin-types`。如果 CLI 使用了新的插件协议类型，应先发布对应版本的 `@magpie-music/plugin-types`，再发布 `@magpie-music/plugin-cli`。

## 发布桌面应用

1. 更新版本号：

```bash
npm pkg set version=1.2.0
npm pkg set version=1.2.0 --prefix app
```

手动同步 `app/src-tauri/Cargo.toml`：

```toml
version = "1.2.0"
```

2. 执行检查：

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm --filter magpie-music-player web:build
```

如果官方插件有变更，确认 `plugins/official-plugins.json` 中列出的官方插件都有对应 release 包。新增官方插件时，同时更新根 README 的官方插件列表。

3. 根据上一个 app tag 到当前提交的 git 历史更新 `CHANGELOG.md`：

```bash
git log --oneline v1.1.0..HEAD
```

确保 `CHANGELOG.md` 存在 `## v1.2.0 - YYYY-MM-DD` 段落。

4. 如果修改了黑名单公钥，重新签名并验证：

```bash
node plugin-blocklist/sign.mjs sign
node plugin-blocklist/sign.mjs verify --public-key app/src/config/pluginBlocklistPublicKey.json
```

5. 提交版本变更：

```bash
git add package.json app/package.json app/src-tauri/Cargo.toml pnpm-lock.yaml CHANGELOG.md plugin-blocklist app/src/config plugins/official-plugins.json plugins/*/plugin.json plugins/*/release/*.zip README.md
git commit -m "Release app v1.2.0"
```

只提交实际变化的文件。没有变化的路径不要强行加入。

6. 创建并推送 app tag：

```bash
git tag v1.2.0
git push github main
git push github v1.2.0
```

7. GitHub Actions 会运行：

```text
.github/workflows/build-desktop.yml
```

该 workflow 会分别构建：

- macOS universal `.dmg`
- Windows `.exe` / `.msi`
- Linux `.AppImage` / `.deb` / `.rpm`

三个平台构建全部成功后，会创建 GitHub Release 并上传桌面应用安装包。

GitHub Release 正文会自动使用 `CHANGELOG.md` 中 `## v1.2.0 - YYYY-MM-DD` 到下一个二级标题之间的内容。

8. 发布完成后检查 GitHub Release 的安装包列表和 Release notes，并按需要同步 Gitee 镜像。

## 发布 @magpie-music/plugin-types

1. 更新版本号：

```bash
npm pkg set version=1.2.0 --prefix packages/plugin-types
```

2. 执行检查：

```bash
pnpm --filter @magpie-music/plugin-types build
pnpm -C packages/plugin-types pack --pack-destination /tmp/magpie-npm-pack
```

确认 tarball 只包含必要文件：

```text
dist/
LICENSE
package.json
```

3. 根据上一个 `plugin-types` tag 到当前提交的 git 历史更新 `CHANGELOG.md`。

4. 提交版本变更：

```bash
git add packages/plugin-types/package.json pnpm-lock.yaml CHANGELOG.md
git commit -m "Release plugin types v1.2.0"
```

5. 创建并推送 npm 包 tag：

```bash
git tag plugin-types-v1.2.0
git push github main
git push github plugin-types-v1.2.0
```

6. GitHub Actions 会运行：

```text
.github/workflows/publish-npm-packages.yml
```

该 workflow 会构建 `@magpie-music/plugin-types` 并发布到 npm。

## 发布 @magpie-music/plugin-cli

1. 确认依赖的 `@magpie-music/plugin-types` 版本已经发布。如果 CLI 需要新的类型包版本，先发布 `plugin-types`。

2. 更新版本号：

```bash
npm pkg set version=1.2.0 --prefix packages/plugin-cli
```

如果需要调整 `plugin-types` 依赖范围，更新：

```text
packages/plugin-cli/package.json
```

工作区内保持 `workspace:*` 即可。`pnpm publish` 会把它转换为实际版本。

3. 执行检查：

```bash
pnpm --filter @magpie-music/plugin-types build
pnpm --filter @magpie-music/plugin-cli test
pnpm -C packages/plugin-cli pack --pack-destination /tmp/magpie-npm-pack
```

确认 tarball 只包含必要文件：

```text
bin/
dist/
LICENSE
package.json
```

确认 `bin/magpie-music.js` 保留：

```text
#!/usr/bin/env node
```

4. 根据上一个 `plugin-cli` tag 到当前提交的 git 历史更新 `CHANGELOG.md`。

5. 提交版本变更：

```bash
git add packages/plugin-cli/package.json pnpm-lock.yaml CHANGELOG.md
git commit -m "Release plugin CLI v1.2.0"
```

6. 创建并推送 npm 包 tag：

```bash
git tag plugin-cli-v1.2.0
git push github main
git push github plugin-cli-v1.2.0
```

7. GitHub Actions 会构建并发布 `@magpie-music/plugin-cli` 到 npm。

## 同时发布两个 npm 包

如果 `plugin-types` 和 `plugin-cli` 需要同一轮发布，推荐顺序：

1. 更新两个 `package.json` 版本。
2. 执行：

```bash
pnpm --filter @magpie-music/plugin-cli test
pnpm -C packages/plugin-types pack --pack-destination /tmp/magpie-npm-pack
pnpm -C packages/plugin-cli pack --pack-destination /tmp/magpie-npm-pack
```

3. 提交：

```bash
git add packages/plugin-types/package.json packages/plugin-cli/package.json pnpm-lock.yaml CHANGELOG.md
git commit -m "Release plugin packages v1.2.0"
```

4. 推送主分支。
5. 先推送 `plugin-types-v1.2.0`。
6. 确认 `@magpie-music/plugin-types` 已在 npm 可见。
7. 再推送 `plugin-cli-v1.2.0`。

也可以手动触发 `Publish npm packages` workflow 并选择 `both`，但正式发布更推荐按 tag 分两步走，方便回溯和失败重试。

## GitHub Actions 手动触发

### 桌面应用

手动触发 `Build desktop installers` 时必须填写已经存在的 app tag，例如：

```text
v1.2.0
```

该 workflow 会 checkout 这个 tag 并发布同名 GitHub Release。

### npm 包

手动触发 `Publish npm packages` 时可以选择：

- `plugin-types`
- `plugin-cli`
- `both`

建议先使用 `dry_run: true` 验证包内容，再用 `dry_run: false` 发布。

## 发布后检查

桌面应用：

- GitHub Release 是否创建成功。
- 三个平台安装包是否齐全。
- Release tag 是否与安装包版本一致。
- Gitee 镜像是否同步。

npm 包：

- npm 页面版本是否出现。
- `npm view @magpie-music/plugin-types version` 是否符合预期。
- `npm view @magpie-music/plugin-cli version` 是否符合预期。
- `magpie-music --help` 是否能正常输出中文帮助。

## 回滚与重试

桌面应用 Release 如果构建失败，修复后可以删除失败 tag 或创建新 patch 版本。不要用同一个 tag 指向不同提交。

npm 包发布后不能真正删除历史版本。发现问题时优先发布新的 patch 版本，并按需要调整 npm dist-tag。

如果 npm workflow 在发布 `plugin-cli` 前失败，而 `plugin-types` 已经发布成功，不要复用已经发布过的版本号。修复后只发布尚未发布的包，或递增 patch 版本重新发布。
