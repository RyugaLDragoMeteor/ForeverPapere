# ForeverPapere

Interactive live wallpaper engine for Windows. Renders a web-based particle animation directly on your desktop behind your icons using the same Win32 technique as [Lively Wallpaper](https://github.com/rocksdanister/lively).

## Download

[![Build](https://github.com/RyugaLDragoMeteor/ForeverPapere/actions/workflows/build.yml/badge.svg)](https://github.com/RyugaLDragoMeteor/ForeverPapere/actions/workflows/build.yml)

**[Latest Release](https://github.com/RyugaLDragoMeteor/ForeverPapere/releases/latest)**

| Download | Description |
|---|---|
| [Portable .exe](https://github.com/RyugaLDragoMeteor/ForeverPapere/releases/latest/download/ForeverPapere-1.0.0-portable.exe) | No install needed — just run it |
| [Installer .exe](https://github.com/RyugaLDragoMeteor/ForeverPapere/releases/latest) | Installs with shortcuts |

## Usage

1. Run `ForeverPapere.exe`
2. The interactive particle wallpaper appears on your desktop
3. Move your mouse to interact — particles react to your cursor
4. Click and hold for a stronger push effect
5. Press **Ctrl+Alt+Q** to quit and restore your normal wallpaper

## How it works

Uses the Win32 WorkerW/Progman technique to embed an Electron window behind your desktop icons:

1. `FindWindow("Progman")` — find the Program Manager
2. `SendMessageTimeout(0x052C)` — spawn the WorkerW layer
3. `SetParent(window, workerW)` — parent the render window behind icons
4. `SetWindowPos(HWND_BOTTOM)` — ensure correct Z-ordering

All Win32 calls are done via [koffi](https://koffi.dev/) FFI from TypeScript — no C++ compilation needed.

## Build from source

```bash
npm install
npm run build
npm start
```

Package as .exe:

```bash
npm run dist
```

Output goes to `release/`.

## Tech stack

- **Electron** — chromium shell for rendering
- **koffi** — zero-compile Win32 FFI from TypeScript
- **HTML Canvas** — particle animation with 60fps render loop
- **esbuild** — fast TypeScript bundling
- **electron-builder** — .exe packaging

## License

MIT
