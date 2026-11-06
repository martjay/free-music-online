<div align="center">

<img src="./res/logo.svg" width="96" height="96" alt="Free Music Online" />

# Free Music Online

A Windows desktop music player with LX source plugins, desktop lyrics, a mini player, and taskbar playback controls.

English | [简体中文](./README.md)

[![License](https://img.shields.io/github/license/martjay/free-music-online?style=flat&color=blue)](./LICENSE)
[![Version](https://img.shields.io/github/package-json/v/martjay/free-music-online?style=flat&color=orange)](./package.json)
[![Stars](https://img.shields.io/github/stars/martjay/free-music-online?style=flat&color=yellow)](https://github.com/martjay/free-music-online/stargazers)

</div>

## About

Free Music Online continues from [AnhePlayer](https://github.com/raclen/AnhePlayer), maintained by [raclen](https://github.com/raclen). This repository keeps that structure and the [AGPL-3.0-only](./LICENSE) license. Reuse and redistribution must keep the original license and attribution.

Installers, update checks, and issues live in [martjay/free-music-online](https://github.com/martjay/free-music-online). This app does not follow the original project's releases.

## Download

Installers are on [GitHub Releases](https://github.com/martjay/free-music-online/releases).

**Windows 10 / 11**:

- `FreeMusicOnline_<version>_x64-setup.exe`

In-app update checks read [`release/version.json`](./release/version.json) on the `main` branch. One-click install downloads that version's setup exe from the matching Release.

## Features

| Area | What it does |
| --- | --- |
| Playback | Queue, repeat, shuffle, loop, speed, quality, and output device |
| Taskbar | Previous, play/pause, and next from the taskbar thumbnail |
| Windows | Remembers the last position and size of the main and mini players |
| Resume | Remembers the queue, current song, volume, and repeat mode |
| Sources | LX plugins. Short previews can switch to a full source before play or download |
| Lyrics | Search, translation, offset, and desktop lyrics |
| Downloads | Folder, quality, concurrency, filenames, duration, and file size |
| Library | Local folders by song, artist, album, and folder |
| Playlists | Create, rename, delete, favorite, and import links |
| Themes | Built-in, local, and remote theme packs |
| Backup | Local files and WebDAV |
| Data | Playlists and settings stay on this computer |

## Plugins

No source plugin is bundled. Install an LX `.js` file, or add an http(s) link ending in `.js`, from Plugin Manager.

Platforms are shown by their short name, such as QQ Music. The full source id still separates plugins that share a name.

## Theme packs

A theme pack is a folder or a `.mftheme` archive:

```text
my-theme/
├── config.json
├── index.css
├── preview.png
└── iframes/
    └── app.html
```

`@/` in `config.json` means the theme root. See [`res/builtin-themes/light/index.css`](./res/builtin-themes/light/index.css).

## Development

| Dependency | Version |
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

| Command | Purpose |
| --- | --- |
| `pnpm tauri:dev` | Development |
| `pnpm tauri:build` | Windows installer |
| `pnpm run lint` | Lint |
| `pnpm run format` | Format |

A release keeps `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tauri.conf.json`, and `release/version.json` on the same version, then pushes a `v<version>` tag to this repository.

## License

[AGPL-3.0-only](./LICENSE).
