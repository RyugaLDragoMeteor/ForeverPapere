// Wallpaper Mambo — Electron main process
// Creates a frameless window and embeds it as the desktop wallpaper
// using the Win32 WorkerW technique (same as Lively Wallpaper).

import { app, BrowserWindow, screen, globalShortcut } from "electron";
import * as path from "path";

// Lazy-load the native module so koffi doesn't init before electron is ready
function getNative(): typeof import("./wallpaper-native") {
  return require("./wallpaper-native");
}

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.size;

  mainWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    frame: false,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Load the interactive background
  const htmlPath = path.join(__dirname, "..", "..", "index.html");
  mainWindow.loadFile(htmlPath);

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow) return;
    mainWindow.show();

    // Get the native HWND and attach to desktop
    const hwndBuffer = mainWindow.getNativeWindowHandle();
    console.log("[wallpaper-mambo] HWND buffer:", hwndBuffer.toString("hex"));

    try {
      const success = getNative().attach(hwndBuffer);
      if (success) {
        console.log("[wallpaper-mambo] Attached to desktop as wallpaper!");
      }
    } catch (err) {
      console.error("[wallpaper-mambo] Failed to attach:", err);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function cleanup() {
  console.log("[wallpaper-mambo] Cleaning up...");
  try { getNative().detach(); } catch (_) {}
  try { getNative().reset(); } catch (_) {}
}

app.on("ready", () => {
  createWindow();

  // Ctrl+Alt+Q to quit and restore normal wallpaper
  globalShortcut.register("CommandOrControl+Alt+Q", () => {
    cleanup();
    app.quit();
  });

  console.log("[wallpaper-mambo] Running! Press Ctrl+Alt+Q to quit.");
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  cleanup();
});

app.on("window-all-closed", () => app.quit());
