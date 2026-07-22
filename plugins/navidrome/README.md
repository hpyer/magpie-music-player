# Navidrome 插件

这是 Magpie Music Player 的官方开源插件，用于连接 Navidrome 或兼容 Subsonic API 的用户自有音乐服务。

插件使用以下 Subsonic 兼容接口：

- `getPlaylists`
- `getPlaylist`
- `stream`
- `getCoverArt`
- `getLyricsBySongId`
- `getLyrics`

## 构建

```bash
pnpm install
pnpm test
pnpm build
```

`pnpm build` 会生成：

```text
release/cn.hpyer.magpie.navidrome-x.x.x.zip
```

## 运行时配置

核心应用会把以下配置传给插件运行时：

```json
{
  "serverUrl": "https://music.example.com",
  "username": "alice",
  "password": "application-password"
}
```

建议使用权限最小的 Navidrome 用户或应用密码。

## 隐私说明

该插件只连接用户在配置中填写的 Navidrome/Subsonic 兼容服务地址。插件会把服务地址、用户名和密码用于请求播放列表、歌曲、播放地址和封面，不会把这些配置发送到其他服务。

## 能力

该插件提供：

- 远程播放列表读取。
- 播放列表歌曲读取。
- 媒体播放地址解析。
- 封面地址读取。
- 歌词读取。

该插件面向用户自有或已授权的 Navidrome 服务，不提供公共音乐搜索能力。
