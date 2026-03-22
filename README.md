# ForeverPapere

A live wallpaper engine for Windows with AI-powered wallpaper generation, a visual novel chatbox, and an interactive mascot companion. Built with Electron and Win32 APIs using the same desktop embedding technique as [Lively Wallpaper](https://github.com/rocksdanister/lively).

## Download

[![Build](https://github.com/RyugaLDragoMeteor/ForeverPapere/actions/workflows/build.yml/badge.svg)](https://github.com/RyugaLDragoMeteor/ForeverPapere/actions/workflows/build.yml)

**[Latest Release](https://github.com/RyugaLDragoMeteor/ForeverPapere/releases/latest)**

| Download | Description |
|---|---|
| [Portable .exe](https://github.com/RyugaLDragoMeteor/ForeverPapere/releases/latest/download/ForeverPapere-1.0.0-portable.exe) | No install needed — just run it |
| [Installer .exe](https://github.com/RyugaLDragoMeteor/ForeverPapere/releases/latest) | Installs with shortcuts |

### Portable vs Installer

**Portable exe** is a single standalone file. Double-click it anywhere and it runs immediately — no installation, no registry entries, no Start Menu shortcuts. Delete the file and it's completely gone. Best for trying it out quickly or running from a USB drive.

**Installer exe** is an NSIS setup wizard. It installs to your Program Files directory, creates a Start Menu shortcut, and registers an uninstaller in Windows Settings so you can remove it cleanly. Best if you want ForeverPapere as a permanent part of your setup.

## Features

### Live Video Wallpaper
- Plays video files as your desktop wallpaper behind your icons
- Multi-monitor support with per-monitor wallpaper windows
- DPI-aware positioning for mixed-scaling setups
- Falls back to particle animation if no video is available

### AI Wallpaper Generation (xAI + OpenRouter)
- **xAI Grok Imagine**: Generate images and videos from text prompts, or use your character PNG as a source for image-to-video generation
- **OpenRouter**: Image generation via chat completions with multiple model support
- Auto-generates a new lofi-style wallpaper on startup and every 30 minutes using your character
- Detects your monitor's aspect ratio (16:9, 16:10, etc.) and generates at 1080p

### Visual Novel Chatbox
- Intro sequence on first launch with typewriter text animation
- Character sprite displayed alongside the chatbox
- Configurable position: top-left, top-right, bottom-left, bottom-center, bottom-right
- Sprite alignment follows chatbox position
- Only plays once — subsequent launches skip the intro

### Mascot Companion
- Persistent character sprite in the bottom-right corner above the taskbar
- Click to open a chat interface powered by OpenRouter (free models)
- Two-box UI: latest message on top, input/waiting indicator on bottom
- Always-on-top so it's visible over all windows

### Frontpaper Overlay
- Transparent click-through overlay at the highest Z-index
- Renders above all windows without blocking interaction
- Respects taskbar bounds

### System Tray
- Quick access to all settings from the tray icon
- Chatbox position selector (6 positions)
- Provider management: set API keys for xAI and OpenRouter
- Generate wallpaper on demand
- Show/hide chatbox and quit

## Hotkeys

| Shortcut | Action |
|---|---|
| `Ctrl+Alt+H` | Toggle VN chatbox |
| `Ctrl+Alt+Q` | Quit and restore wallpaper |

## How It Works

Uses the Win32 WorkerW/Progman technique to embed Electron windows behind desktop icons:

1. `FindWindow("Progman")` — find the Program Manager
2. `SendMessageTimeout(0x052C)` — spawn the WorkerW layer
3. `SetParent(window, workerW)` — parent render windows behind icons
4. `MapWindowPoints` — correct per-monitor positioning within WorkerW

Supports Windows 11 24H2+ (Build 26002+) where WorkerW is created as a child of Progman instead of a sibling.

All Win32 calls are done via [koffi](https://koffi.dev/) FFI from TypeScript — no C++ compilation needed.

## Data Storage

All app data lives in `%APPDATA%/ForeverPapere/`:

| File/Folder | Purpose |
|---|---|
| `config.json` | API keys, intro state, settings |
| `media.json` | Media database (images, videos, characters) |
| `media/images/` | Uploaded and generated images |
| `media/videos/` | Uploaded and generated videos |

## Dev Setup

```bash
npm install
npm run build
npm start
```

Place initial media in `bundled/images/` and `bundled/videos/` — these are copied to the user's app data on first launch. During development, files from `src/images/` and `src/videos/` are used instead.

### Package as .exe

```bash
npm run dist
```

Output goes to `release/`.

## Tech Stack

- **Electron** — Chromium shell for rendering
- **koffi** — Zero-compile Win32 FFI from TypeScript
- **HTML Canvas** — Video-to-canvas rendering (bypasses GPU compositing issues)
- **esbuild** — Fast TypeScript bundling
- **electron-builder** — .exe packaging (portable + NSIS installer)
- **xAI Grok Imagine** — AI image and video generation
- **OpenRouter** — AI chat and image generation (free tier available)

## License

MIT
