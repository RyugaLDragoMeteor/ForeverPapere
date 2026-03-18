// ForeverPapere — Electron main process
// Wallpaper window embedded behind desktop icons + VN chatbox overlay + tray settings.

import { app, BrowserWindow, screen, globalShortcut, ipcMain, Tray, Menu, nativeImage } from "electron";
import * as path from "path";
import * as fs from "fs";

function getNative(): typeof import("./wallpaper-native") {
  return require("./wallpaper-native");
}

let mainWindow: BrowserWindow | null = null;
let chatboxWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// Settings
type ChatboxPosition = "left" | "center" | "right";
let chatboxPosition: ChatboxPosition = "center";
const CHATBOX_WIDTH = 900;
const CHATBOX_HEIGHT = 520; // taller to fit character sprite above text box
const CHATBOX_MARGIN = 20;

// ── Chatbox positioning ──────────────────────────────────────
function getChatboxBounds() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().size;
  const y = screenH - CHATBOX_HEIGHT - CHATBOX_MARGIN;
  let x: number;

  switch (chatboxPosition) {
    case "left":
      x = CHATBOX_MARGIN;
      break;
    case "right":
      x = screenW - CHATBOX_WIDTH - CHATBOX_MARGIN;
      break;
    case "center":
    default:
      x = Math.round((screenW - CHATBOX_WIDTH) / 2);
      break;
  }

  return { x, y, width: CHATBOX_WIDTH, height: CHATBOX_HEIGHT };
}

// ── Wallpaper window ─────────────────────────────────────────
function createWallpaperWindow() {
  const display = screen.getPrimaryDisplay();
  const sf = display.scaleFactor || 1;
  const width = Math.round(display.workAreaSize.width * sf);
  const height = Math.round(display.workAreaSize.height * sf);

  mainWindow = new BrowserWindow({
    width, height, x: 0, y: 0,
    frame: false,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false, // Allow loading local video files
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "..", "index.html"));

  // Pipe renderer console to main process for debugging
  mainWindow.webContents.on("console-message", (_e, _level, message) => {
    console.log("[renderer]", message);
  });

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow) return;
    mainWindow.show();

    const hwndBuffer = mainWindow.getNativeWindowHandle();
    const d = screen.getPrimaryDisplay();
    const sf2 = d.scaleFactor || 1;
    const sw = Math.round(d.workAreaSize.width * sf2);
    const sh = Math.round(d.workAreaSize.height * sf2);
    try {
      const success = getNative().attach(hwndBuffer, sw, sh);
      if (success) console.log("[forever-papere] Wallpaper attached!");
    } catch (err) {
      console.error("[forever-papere] Failed to attach:", err);
    }

    createChatboxWindow();
  });

  mainWindow.on("closed", () => { mainWindow = null; });
}

// ── VN Chatbox window ────────────────────────────────────────
function createChatboxWindow() {
  if (chatboxWindow && !chatboxWindow.isDestroyed()) {
    chatboxWindow.close();
  }

  const bounds = getChatboxBounds();

  chatboxWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "chatbox-preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  chatboxWindow.loadFile(path.join(__dirname, "..", "..", "chatbox.html"));
  chatboxWindow.once("ready-to-show", () => chatboxWindow?.show());

  chatboxWindow.webContents.on("before-input-event", (_event, input) => {
    if (input.control && input.alt && input.key === "q") {
      cleanup();
      app.quit();
    }
  });

  chatboxWindow.on("closed", () => { chatboxWindow = null; });
}

function repositionChatbox(pos: ChatboxPosition) {
  chatboxPosition = pos;
  if (chatboxWindow && !chatboxWindow.isDestroyed()) {
    const bounds = getChatboxBounds();
    chatboxWindow.setBounds(bounds);
  }
  rebuildTrayMenu();
}

// ── IPC ──────────────────────────────────────────────────────
ipcMain.on("chatbox-dismiss", () => {
  if (chatboxWindow && !chatboxWindow.isDestroyed()) {
    chatboxWindow.close();
  }
});

ipcMain.on("chatbox-reshow", () => {
  createChatboxWindow();
});

ipcMain.on("wallpaper-get-config", (event) => {
  const videosDir = path.join(__dirname, "..", "..", "src", "videos");
  let videoFile = "";

  try {
    const videoExts = [".mp4", ".webm", ".mkv", ".mov", ".avi"];
    const files = fs.readdirSync(videosDir);
    const found = files.find((f) => videoExts.includes(path.extname(f).toLowerCase()));
    if (found) {
      videoFile = path.join(videosDir, found);
    }
  } catch (_) {
    // No videos directory or can't read it
  }

  console.log(`[forever-papere] Videos dir: ${videosDir}, found: ${videoFile || "none (using particle fallback)"}`);
  event.returnValue = { videosDir, videoFile };
});

ipcMain.on("chatbox-get-config", (event) => {
  const imagesDir = path.join(__dirname, "..", "..", "src", "images");
  event.returnValue = {
    position: chatboxPosition,
    imagesDir,
  };
});

// ── System tray ──────────────────────────────────────────────
function rebuildTrayMenu() {
  if (!tray) return;

  const menu = Menu.buildFromTemplate([
    { label: "ForeverPapere", enabled: false },
    { type: "separator" },
    {
      label: "Chatbox Position",
      submenu: [
        {
          label: "Left",
          type: "radio",
          checked: chatboxPosition === "left",
          click: () => repositionChatbox("left"),
        },
        {
          label: "Center",
          type: "radio",
          checked: chatboxPosition === "center",
          click: () => repositionChatbox("center"),
        },
        {
          label: "Right",
          type: "radio",
          checked: chatboxPosition === "right",
          click: () => repositionChatbox("right"),
        },
      ],
    },
    {
      label: "Show Chatbox",
      click: () => createChatboxWindow(),
    },
    { type: "separator" },
    {
      label: "Quit (Ctrl+Alt+Q)",
      click: () => { cleanup(); app.quit(); },
    },
  ]);

  tray.setContextMenu(menu);
}

function createTray() {
  // Create a simple 16x16 tray icon (purple square)
  const icon = nativeImage.createFromBuffer(
    createTrayIconBuffer(),
    { width: 16, height: 16 }
  );
  tray = new Tray(icon);
  tray.setToolTip("ForeverPapere");
  rebuildTrayMenu();
}

function createTrayIconBuffer(): Buffer {
  // Generate a 16x16 RGBA purple square icon
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const x = i % size;
    const y = Math.floor(i / size);
    // Rounded corners: skip corner pixels
    const corner = (x < 2 && y < 2) || (x > 13 && y < 2) ||
                   (x < 2 && y > 13) || (x > 13 && y > 13);
    if (corner) {
      buf.writeUInt32BE(0x00000000, i * 4); // transparent
    } else {
      // Purple gradient
      const r = 99 + Math.round((x / size) * 40);
      const g = 102 - Math.round((y / size) * 30);
      const b = 241;
      buf[i * 4] = r;
      buf[i * 4 + 1] = g;
      buf[i * 4 + 2] = b;
      buf[i * 4 + 3] = 255;
    }
  }
  return buf;
}

// ── Cleanup ──────────────────────────────────────────────────
function cleanup() {
  console.log("[forever-papere] Cleaning up...");
  try { getNative().detach(); } catch (_) {}
  try { getNative().reset(); } catch (_) {}
  if (chatboxWindow && !chatboxWindow.isDestroyed()) chatboxWindow.close();
  if (tray) { tray.destroy(); tray = null; }
}

// ── App lifecycle ────────────────────────────────────────────
app.on("ready", () => {
  createTray();
  createWallpaperWindow();

  globalShortcut.register("CommandOrControl+Alt+Q", () => {
    cleanup();
    app.quit();
  });

  // Ctrl+Alt+H toggles chatbox
  globalShortcut.register("CommandOrControl+Alt+H", () => {
    if (chatboxWindow && !chatboxWindow.isDestroyed()) {
      chatboxWindow.close();
    } else {
      createChatboxWindow();
    }
  });

  console.log("[forever-papere] Running! Ctrl+Alt+H = toggle chatbox, Ctrl+Alt+Q = quit.");
});

// Handle external kill (taskkill, SIGTERM, etc.)
process.on("SIGTERM", () => { cleanup(); app.quit(); });
process.on("SIGINT", () => { cleanup(); app.quit(); });
process.on("exit", () => { try { getNative().detach(); getNative().reset(); } catch (_) {} });

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  cleanup();
});

app.on("window-all-closed", (e: Event) => {
  // Don't quit when chatbox closes — wallpaper + tray stay alive
  e.preventDefault();
});
