<div align="center">

<img src="./res/logo.svg" width="96" height="96" alt="Free Music Online" />

# Free Music Online

一款给 Windows 用的桌面音乐播放器。支持洛雪音源插件、桌面歌词、迷你播放器，以及悬停任务栏图标时直接切歌。

[English](./README_EN.md) | 简体中文

[![License](https://img.shields.io/github/license/martjay/free-music-online?style=flat&color=blue)](./LICENSE)
[![Version](https://img.shields.io/github/package-json/v/martjay/free-music-online?style=flat&color=orange)](./package.json)
[![Stars](https://img.shields.io/github/stars/martjay/free-music-online?style=flat&color=yellow)](https://github.com/martjay/free-music-online/stargazers)

</div>

## 说明

Free Music Online 在 [AnhePlayer](https://github.com/raclen/AnhePlayer) 上继续改。原项目由 [raclen](https://github.com/raclen) 维护，本仓库保留它的代码结构和 [AGPL-3.0-only](./LICENSE) 许可证。使用、修改或再发布时，需要同时保留原项目的许可和署名。

本仓库的安装包、更新检查和问题反馈都在 [martjay/free-music-online](https://github.com/martjay/free-music-online)。软件不会跟着原项目的发版走。

## 下载

安装包在 [GitHub Releases](https://github.com/martjay/free-music-online/releases)。

当前支持 **Windows 10 / 11**：

- `FreeMusicOnline_<版本>_x64-setup.exe`

软件内的「检查更新」读取本仓库 `main` 分支的 [`release/version.json`](./release/version.json)。发现新版本后，一键安装会下载对应 Release 里的这个 exe。

## 功能

| 模块 | 能力 |
| --- | --- |
| 播放 | 播放队列、顺序 / 随机 / 单曲循环、倍速、音质、输出设备 |
| 任务栏 | 悬停任务栏图标，可直接上一首、播放暂停、下一首 |
| 窗口 | 记住主窗口和小播放器上次的位置与大小 |
| 续播 | 记住播放列表、当前歌曲、音量和播放模式 |
| 音源 | 洛雪插件解析；试听过短时，播放和下载前自动换到能听全的平台 |
| 歌词 | 歌词搜索、翻译、偏移、桌面歌词 |
| 下载 | 下载目录、音质、并发和文件名；已完成列表显示时长和文件大小 |
| 本地 | 扫描本地文件夹，按单曲、歌手、专辑、文件夹管理 |
| 歌单 | 创建、重命名、删除、收藏，以及单曲 / 歌单链接导入 |
| 主题 | 内置主题、本地主题包和远程主题包 |
| 备份 | 本地文件备份、WebDAV 备份恢复 |
| 数据 | 歌单和设置保存在本机，不上传个人数据 |

## 插件

默认不带音源插件。在插件管理里安装洛雪 `.js` 文件，或添加以 `.js` 结尾的 http(s) 链接。

插件提供的平台会显示成短名，例如「QQ音乐」「酷我音乐」。内部仍用完整来源区分不同脚本，避免两家同名音源串在一起。

## 主题包

主题包可以是文件夹，也可以是 `.mftheme`：

```text
my-theme/
├── config.json
├── index.css
├── preview.png
└── iframes/
    └── app.html
```

`config.json` 里用 `@/` 表示主题包根目录。变量写法见 [`res/builtin-themes/light/index.css`](./res/builtin-themes/light/index.css)。

## 开发

| 依赖 | 版本 |
| --- | --- |
| Node.js | 22 |
| pnpm | 9+ |
| Rust | 1.80+ |

```bash
git clone https://github.com/martjay/free-music-online.git
cd free-music-online
pnpm install
pnpm tauri:dev
```

| 命令 | 作用 |
| --- | --- |
| `pnpm tauri:dev` | 开发模式 |
| `pnpm tauri:build` | 打 Windows 安装包 |
| `pnpm run lint` | 检查 |
| `pnpm run format` | 格式化 |

发版时把 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`、`src-tauri/tauri.conf.json` 和 `release/version.json` 改成同一个版本，再把 `v<版本>` 标签推到本仓库。

## 许可证

[AGPL-3.0-only](./LICENSE)。
