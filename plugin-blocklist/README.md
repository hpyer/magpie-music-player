# 插件黑名单说明

`plugin-blocklist/` 用来托管 Magpie Music Player 的远程插件黑名单。黑名单的目的不是替代应用商店审核，也不是判断所有插件好坏，而是在出现明确风险、侵权投诉或严重违规时，让播放器可以及时阻止相关插件继续加载。

## 普通用户

黑名单用于保护用户设备、账号、媒体库和合法权益。

当应用启动或同步插件时，会静默检查远程黑名单。检查逻辑是：

1. 优先从 Gitee 镜像读取列表，方便国内访问。
2. 如果 Gitee 失败，再从 GitHub 主仓库读取。
3. 如果两个地址都失败，继续使用本地已缓存且通过签名校验的上一版列表。
4. 如果没有可用缓存，播放器继续启动，不阻塞本地播放。

应用不会上传你的插件列表、插件配置、媒体库、播放记录、本地路径或账号信息。黑名单检查只下载公开列表和签名文件，并在本地比较。

只有当某个已安装插件新命中黑名单并被自动禁用时，应用才会提示你。普通的远程加载失败不会弹窗打扰。如果黑名单签名校验失败，应用会给出警告并建议升级到最新版，因为这可能意味着应用内置公钥不匹配，或远程列表存在异常。

如果插件被阻止加载，建议先停止使用该插件，并查看提示中的原因或详情链接。不要从未知来源重新安装同名插件或绕过阻止逻辑。

## 版权方与权利人

如果你认为某个插件侵犯了你的版权、商标、服务条款、接口使用规则或其他合法权益，可以通过 GitHub Issue 发起投诉：

```text
https://github.com/hpyer/magpie-music-player/issues
```

投诉建议包含：

- 被投诉插件的名称、插件 id、下载地址或发布页面。
- 具体侵权或违规行为说明。
- 相关权利证明或可公开核验的材料。
- 希望采取的措施，例如临时阻止、永久阻止或补充说明。
- 可联系的邮箱或公开联系方式。

项目维护者会根据材料完整度、风险紧急程度和可核验性进行处理。对于明显恶意、钓鱼、窃取凭据、传播未授权内容或绕过平台访问规则的插件，维护者可以先加入黑名单，再继续核实。

黑名单仅影响 Magpie Music Player 是否加载相关插件，不代表替代法律程序、平台投诉程序或权利人与插件作者之间的争议解决。

## 插件作者

如果你的插件被加入黑名单，可以通过 GitHub Issue 申诉：

```text
https://github.com/hpyer/magpie-music-player/issues
```

申诉建议包含：

- 插件名称、插件 id、版本和发布地址。
- 被黑名单命中的条目 id 或应用提示中的原因。
- 插件源码、构建产物或可复现的审计材料。
- 插件访问的服务、接口、数据来源和授权方式说明。
- 已修复问题的版本、变更说明和重新发布地址。

维护者会优先关注以下问题：

- 是否收集或上传与插件功能无关的数据。
- 是否绕过用户授权、主应用权限提示或网络来源限制。
- 是否提供、索引、分发或下载未经授权的媒体、歌词、封面或元数据。
- 是否伪装来源、隐藏真实网络请求或规避缓存边界。
- 是否存在恶意代码、凭据泄露、远程执行或供应链风险。

申诉通过后，维护者可以移除或调整对应黑名单条目。为了保护用户，已发布的旧版本如果仍有风险，可能会继续保留在黑名单中。

## 维护者

### 文件结构

```text
plugin-blocklist/
  blocklist.json      黑名单列表。
  blocklist.json.sig  黑名单签名文件，发布时生成。
  public-key.jwk      当前公钥的维护者本地副本，不纳入 Git。
  private-key.jwk     当前签名私钥，只保存在维护者本地，不纳入 Git。
  README.md           本说明。
  sign.mjs            签名脚本。
```

应用实际信任的公钥位于：

```text
app/src/config/pluginBlocklistPublicKey.json
```

该文件会随应用一起构建和发布，是客户端校验黑名单签名的信任锚。

`blocklist.json` 即使为空，也必须保留合法 JSON 结构：

```json
{
  "version": 1,
  "updatedAt": "2026-07-21T00:00:00.000Z",
  "entries": []
}
```

条目示例：

```json
{
  "id": "block-example-plugin",
  "pluginIds": ["com.example.plugin"],
  "signerIds": ["example-signer"],
  "packageHashes": ["sha256-package-hash"],
  "entryHashes": ["sha256-entry-hash"],
  "networkOrigins": ["https://api.example.com"],
  "reason": "阻止原因",
  "detailsUrl": "https://github.com/hpyer/magpie-music-player/issues/1",
  "severity": "block"
}
```

匹配字段可以只填其中一类。`severity` 目前支持：

- `block`：阻止插件加载。
- `warn`：在插件列表显示警告原因，但不阻止插件加载。

### 更新黑名单

1. 根据投诉、审计或安全事件确认需要新增、修改或删除的条目。
2. 修改 `plugin-blocklist/blocklist.json`。
3. 更新 `updatedAt`。
4. 重新生成 `plugin-blocklist/blocklist.json.sig`。
5. 提交 pull request 或维护者提交。
6. 确认 GitHub 主仓库更新后，同步 Gitee 镜像。

签名当前列表：

```bash
node plugin-blocklist/sign.mjs sign
```

指定输入和输出：

```bash
node plugin-blocklist/sign.mjs sign \
  --input plugin-blocklist/blocklist.json \
  --output plugin-blocklist/blocklist.json.sig \
  --private-key plugin-blocklist/private-key.jwk
```

本地验证签名：

```bash
node plugin-blocklist/sign.mjs verify
```

### 更新密钥

生成初始密钥对：

```bash
node plugin-blocklist/sign.mjs generate-key
```

脚本会在 `plugin-blocklist/` 下创建：

```text
private-key.jwk
public-key.jwk
```

同时会把同一份 public JWK 写入应用配置：

```text
app/src/config/pluginBlocklistPublicKey.json
```

应用目录里的 `pluginBlocklistPublicKey.json` 是客户端内置可信公钥。

如果要轮换密钥时使用：

```bash
node plugin-blocklist/sign.mjs generate-key --force
```

也可以指定路径：

```bash
node plugin-blocklist/sign.mjs generate-key \
  --private-key plugin-blocklist/private-key.jwk \
  --public-key plugin-blocklist/public-key.jwk
```

密钥轮换规则：

- 先生成新密钥对。
- 脚本会自动把新的 public JWK 写入 `app/src/config/pluginBlocklistPublicKey.json`。
- 发布包含新公钥的应用版本。
- 保留旧私钥一段过渡期，继续用旧私钥签名当前黑名单。
- 等主要用户升级后，再切换到新私钥签名。
- 如果旧私钥疑似泄露，应尽快发布新 public JWK，并停止信任旧密钥。

当前使用应用内置公钥。如需轮换客户端可信公钥，必须发布新版应用。

### 防止随意修改

维护黑名单时应遵守以下规则：

- 所有条目应有可追溯原因，优先填写 `reason` 和 `detailsUrl`。
- 涉及版权或权利投诉时，保留投诉材料和处理记录。
- 涉及安全风险时，避免在公开条目里泄露可被滥用的攻击细节。
- `blocklist.json` 的修改必须重新签名，否则客户端会拒绝使用。
- 私钥不能进入 Git、日志、Issue、PR、构建产物或截图。
- Gitee 仅作为镜像，应从 GitHub 主仓库同步，避免两边内容长期分叉。
- 重要条目建议经过至少一名维护者复核后合并。

### 远程地址

应用默认按顺序加载：

```text
https://gitee.com/Hpyer/magpie-music-player/raw/main/plugin-blocklist/blocklist.json
https://raw.githubusercontent.com/hpyer/magpie-music-player/main/plugin-blocklist/blocklist.json
```

签名文件默认是 `<blocklist-url>.sig`：

```text
https://gitee.com/Hpyer/magpie-music-player/raw/main/plugin-blocklist/blocklist.json.sig
https://raw.githubusercontent.com/hpyer/magpie-music-player/main/plugin-blocklist/blocklist.json.sig
```

普通网络加载失败应保持静默；只有当新匹配的插件被自动禁用时，应用才提示用户。签名校验失败应提示用户升级应用，因为客户端内置公钥可能不匹配，或远程列表、签名文件存在异常。
