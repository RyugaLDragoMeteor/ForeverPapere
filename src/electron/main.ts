// ForeverPapere — Electron main process
// Wallpaper window embedded behind desktop icons + VN chatbox overlay + tray settings.

import { app, BrowserWindow, screen, globalShortcut, ipcMain, Tray, Menu, nativeImage } from "electron";
import * as path from "path";
import * as fs from "fs";
import { generateImage, generateVideo, generateCharacterVideo, saveApiKey, hasApiKey } from "./xai-api";
import { closeDb, importMedia, getAllMedia, getDefaultWallpaper, ensureCharacter, linkMediaToCharacter, VIDEOS_DIR, IMAGES_DIR, MEDIA_DIR } from "./media-db";

function getNative(): typeof import("./wallpaper-native") {
  return require("./wallpaper-native");
}

let mainWindow: BrowserWindow | null = null;
let chatboxWindow: BrowserWindow | null = null;
let promptWindow: BrowserWindow | null = null;
let apikeyWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// Settings
type ChatboxPosition = "bottom-left" | "bottom-center" | "bottom-right" | "top-left" | "top-right";
let chatboxPosition: ChatboxPosition = "bottom-center";
const CHATBOX_WIDTH = 900;
const CHATBOX_HEIGHT = 520;
const CHATBOX_MARGIN = 20;

// ── Chatbox positioning ──────────────────────────────────────
function getChatboxBounds() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().size;
  let x: number, y: number;

  // Horizontal
  if (chatboxPosition.includes("left")) {
    x = CHATBOX_MARGIN;
  } else if (chatboxPosition.includes("right")) {
    x = screenW - CHATBOX_WIDTH - CHATBOX_MARGIN;
  } else {
    x = Math.round((screenW - CHATBOX_WIDTH) / 2);
  }

  // Vertical
  if (chatboxPosition.startsWith("top")) {
    y = CHATBOX_MARGIN;
  } else {
    y = screenH - CHATBOX_HEIGHT - CHATBOX_MARGIN;
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
  // Recreate chatbox so renderer picks up the new position for sprite alignment
  if (chatboxWindow && !chatboxWindow.isDestroyed()) {
    createChatboxWindow();
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

// ── First-launch migration ───────────────────────────────────
// Copy bundled videos/images to app data directory and register in DB
function migrateBundledMedia() {
  const bundledVideos = path.join(__dirname, "..", "..", "bundled", "videos");
  const bundledImages = path.join(__dirname, "..", "..", "bundled", "images");

  // Check if we already migrated (any media in DB means we did)
  const existing = getAllMedia();
  if (existing.length > 0) {
    console.log("[forever-papere] Media DB has entries, skipping migration");
    return;
  }

  console.log("[forever-papere] First launch — migrating bundled media...");

  // Migrate videos
  const videoExts = [".mp4", ".webm", ".mkv", ".mov", ".avi"];
  try {
    for (const f of fs.readdirSync(bundledVideos)) {
      if (videoExts.includes(path.extname(f).toLowerCase()) && !f.startsWith("generated_") && !f.startsWith("test_")) {
        const src = path.join(bundledVideos, f);
        importMedia(src, "video", ["uploaded", "bundled"]);
        console.log("[forever-papere] Migrated video:", f);
      }
    }
  } catch (_) { /* no bundled videos */ }

  // Migrate images and auto-create characters from filenames
  const imgExts = [".png", ".jpg", ".jpeg", ".webp"];
  try {
    for (const f of fs.readdirSync(bundledImages)) {
      if (imgExts.includes(path.extname(f).toLowerCase())) {
        const src = path.join(bundledImages, f);
        const record = importMedia(src, "image", ["uploaded", "bundled", "character"]);

        // Derive character name from filename (strip extension, replace separators)
        const baseName = path.basename(f, path.extname(f));
        const charName = baseName.split(/[-_]/)[0].trim() || baseName;
        const character = ensureCharacter(charName);
        linkMediaToCharacter(record.id, character.id);

        console.log(`[forever-papere] Migrated image: ${f} → character "${character.name}" (id=${character.id})`);
      }
    }
  } catch (_) { /* no bundled images */ }
}

ipcMain.on("wallpaper-get-config", (event) => {
  // Check DB for latest video/image, then fall back to bundled
  const record = getDefaultWallpaper();
  let videoFile = "";

  if (record) {
    videoFile = record.filepath;
  } else {
    // Fallback: check bundled videos
    const bundledDir = path.join(__dirname, "..", "..", "bundled", "videos");
    try {
      const videoExts = [".mp4", ".webm", ".mkv", ".mov", ".avi"];
      const found = fs.readdirSync(bundledDir)
        .find((f) => videoExts.includes(path.extname(f).toLowerCase()));
      if (found) videoFile = path.join(bundledDir, found);
    } catch (_) {}
  }

  console.log(`[forever-papere] Wallpaper: ${videoFile || "none (particles)"}`);
  event.returnValue = { videosDir: VIDEOS_DIR, videoFile };
});

ipcMain.on("chatbox-get-config", (event) => {
  // Use app data images dir for character sprites
  event.returnValue = {
    position: chatboxPosition,
    imagesDir: IMAGES_DIR,
  };
});

// ── xAI Generation dialogs ───────────────────────────────────
function openApiKeyDialog() {
  if (apikeyWindow && !apikeyWindow.isDestroyed()) { apikeyWindow.focus(); return; }
  apikeyWindow = new BrowserWindow({
    width: 400, height: 200, frame: false, resizable: false,
    alwaysOnTop: true, skipTaskbar: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  apikeyWindow.loadFile(path.join(__dirname, "..", "..", "apikey-dialog.html"));
  apikeyWindow.on("closed", () => { apikeyWindow = null; });
}

function openPromptDialog() {
  if (!hasApiKey()) { openApiKeyDialog(); return; }
  if (promptWindow && !promptWindow.isDestroyed()) { promptWindow.focus(); return; }
  promptWindow = new BrowserWindow({
    width: 480, height: 520, frame: false, resizable: false,
    alwaysOnTop: true, skipTaskbar: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  promptWindow.loadFile(path.join(__dirname, "..", "..", "prompt-dialog.html"));
  promptWindow.on("closed", () => { promptWindow = null; });
}

// Tell the wallpaper renderer to reload with a new media file
function reloadWallpaper(filePath: string) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const fileUrl = `file:///${filePath.replace(/\\/g, "/")}`;
    mainWindow.webContents.send("wallpaper-reload", fileUrl);
    console.log("[forever-papere] Reloading wallpaper:", fileUrl);
  }
}

// ── xAI IPC handlers ────────────────────────────────────────
ipcMain.on("apikey-save", (_e, key: string) => {
  saveApiKey(key);
  if (apikeyWindow && !apikeyWindow.isDestroyed()) apikeyWindow.close();
  rebuildTrayMenu();
  console.log("[forever-papere] API key saved");
});

ipcMain.on("apikey-cancel", () => {
  if (apikeyWindow && !apikeyWindow.isDestroyed()) apikeyWindow.close();
});

ipcMain.on("prompt-cancel", () => {
  if (promptWindow && !promptWindow.isDestroyed()) promptWindow.close();
});

ipcMain.on("prompt-get-config", (event) => {
  let characterImages: string[] = [];
  try {
    const imgExts = [".png", ".jpg", ".jpeg", ".webp"];
    characterImages = fs.readdirSync(IMAGES_DIR)
      .filter((f) => imgExts.includes(path.extname(f).toLowerCase()));
  } catch (_) { /* no images dir */ }
  event.returnValue = { imagesDir: IMAGES_DIR, characterImages };
});

ipcMain.on("prompt-submit", async (_e, opts: {
  prompt: string; type: string; source: string; aspectRatio: string;
  duration: number; resolution: string;
}) => {
  // Resolve source image path and character from DB
  let sourceImagePath: string | undefined;
  let sourceImageId: number | undefined;
  let characterId: number | undefined;

  if (opts.source === "character") {
    // Find the first character sprite in the DB
    const charImages = getAllMedia("image").filter((r) => r.tags.includes("character"));
    if (charImages.length > 0) {
      sourceImagePath = charImages[0].filepath;
      sourceImageId = charImages[0].id;
      characterId = charImages[0].character_id || undefined;
    }
  }

  try {
    let result;
    if (opts.type === "video" && sourceImagePath) {
      // Two-step: image-edit → animate
      result = await generateCharacterVideo({
        prompt: opts.prompt,
        duration: opts.duration,
        aspectRatio: opts.aspectRatio,
        resolution: opts.resolution,
        sourceImagePath,
        sourceImageId,
        characterId,
      }, (msg) => {
        if (promptWindow && !promptWindow.isDestroyed()) {
          promptWindow.webContents.send("generation-status", msg);
        }
      });
    } else if (opts.type === "video") {
      if (promptWindow) promptWindow.webContents.send("generation-status", "Generating video... this may take several minutes.");
      result = await generateVideo({
        prompt: opts.prompt,
        duration: opts.duration,
        aspectRatio: opts.aspectRatio,
        resolution: opts.resolution,
      });
    } else {
      const msg = sourceImagePath
        ? "Generating image from character PNG..."
        : "Generating image...";
      if (promptWindow) promptWindow.webContents.send("generation-status", msg);
      result = await generateImage({
        prompt: opts.prompt,
        aspectRatio: opts.aspectRatio,
        sourceImagePath,
        sourceImageId,
        characterId,
      });
    }

    if (result.success && result.filePath) {
      if (promptWindow) promptWindow.webContents.send("generation-success", "Done! Applying as wallpaper...");
      reloadWallpaper(result.filePath);
    } else {
      if (promptWindow) promptWindow.webContents.send("generation-error", result.error || "Unknown error");
    }
  } catch (err: any) {
    console.error("[xai] Generation error:", err);
    if (promptWindow) promptWindow.webContents.send("generation-error", err.message || "Generation failed");
  }
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
          label: "Bottom Left",
          type: "radio",
          checked: chatboxPosition === "bottom-left",
          click: () => repositionChatbox("bottom-left"),
        },
        {
          label: "Bottom Center",
          type: "radio",
          checked: chatboxPosition === "bottom-center",
          click: () => repositionChatbox("bottom-center"),
        },
        {
          label: "Bottom Right",
          type: "radio",
          checked: chatboxPosition === "bottom-right",
          click: () => repositionChatbox("bottom-right"),
        },
        {
          label: "Top Left",
          type: "radio",
          checked: chatboxPosition === "top-left",
          click: () => repositionChatbox("top-left"),
        },
        {
          label: "Top Right",
          type: "radio",
          checked: chatboxPosition === "top-right",
          click: () => repositionChatbox("top-right"),
        },
      ],
    },
    {
      label: "Show Chatbox",
      click: () => createChatboxWindow(),
    },
    { type: "separator" },
    {
      label: "Generate Wallpaper (xAI)",
      click: () => openPromptDialog(),
    },
    {
      label: hasApiKey() ? "Change xAI API Key" : "Set xAI API Key",
      click: () => openApiKeyDialog(),
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
  try { closeDb(); } catch (_) {}
  if (chatboxWindow && !chatboxWindow.isDestroyed()) chatboxWindow.close();
  if (tray) { tray.destroy(); tray = null; }
}

// ── App lifecycle ────────────────────────────────────────────
app.on("ready", () => {
  migrateBundledMedia();
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
