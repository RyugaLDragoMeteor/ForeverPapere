// ForeverPapere — Electron main process
// Wallpaper window embedded behind desktop icons + VN chatbox overlay + tray settings.

import { app, BrowserWindow, screen, globalShortcut, ipcMain, Tray, Menu, nativeImage, net, desktopCapturer } from "electron";
import * as path from "path";
import * as fs from "fs";
import { generateImage as orGenerateImage, generateCharacterWallpaper } from "./openrouter-api";
import { startOAuthFlow, hasApiKey as hasOpenRouterKey, saveApiKey as saveOpenRouterKey, getApiKey as getOpenRouterKey } from "./openrouter-auth";
import { generateImage as xaiGenerateImage, generateVideo, generateCharacterVideo, saveApiKey as saveXaiKey, hasApiKey as hasXaiKey } from "./xai-api";
import { closeDb, importMedia, getAllMedia, getDefaultWallpaper, ensureCharacter, linkMediaToCharacter, VIDEOS_DIR, IMAGES_DIR, MEDIA_DIR } from "./media-db";
import { ChatboxPosition, detectAspectRatio, computeChatboxBounds, createTrayIconBuffer, getSpriteAlign, CHATBOX_WIDTH, CHATBOX_HEIGHT } from "./utils";

function getNative(): typeof import("./wallpaper-native") {
  return require("./wallpaper-native");
}

// ── Config helpers (shared config.json in %APPDATA%) ─────
function getConfigPath(): string {
  return path.join(process.env.APPDATA || process.env.HOME || ".", "ForeverPapere", "config.json");
}
function readAppConfig(): Record<string, unknown> {
  try { return JSON.parse(fs.readFileSync(getConfigPath(), "utf-8")); } catch { return {}; }
}
function writeAppConfig(config: Record<string, unknown>): void {
  const dir = path.dirname(getConfigPath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
}
function hasSeenIntro(): boolean {
  return readAppConfig().introSeen === true;
}
function markIntroSeen(): void {
  const config = readAppConfig();
  config.introSeen = true;
  writeAppConfig(config);
}

let wallpaperWindows: BrowserWindow[] = [];
let frontpaperWindow: BrowserWindow | null = null;
let chatboxWindow: BrowserWindow | null = null;
let promptWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// Settings
let chatboxPosition: ChatboxPosition = "bottom-center";

// ── Chatbox positioning ──────────────────────────────────────
function getChatboxBounds() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  return computeChatboxBounds(screenW, screenH, chatboxPosition);
}

// ── Frontpaper window (transparent overlay on top of everything) ──
function createFrontpaperWindow() {
  const primary = screen.getPrimaryDisplay();
  const workArea = primary.workAreaSize;

  frontpaperWindow = new BrowserWindow({
    width: workArea.width,
    height: workArea.height,
    x: primary.workArea.x,
    y: primary.workArea.y,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    resizable: false,
    alwaysOnTop: true,
    focusable: false,
    hasShadow: false,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  frontpaperWindow.setIgnoreMouseEvents(true);
  frontpaperWindow.loadFile(path.join(__dirname, "..", "..", "frontpaper.html"));

  frontpaperWindow.webContents.on("console-message", (_e, _level, message) => {
    console.log(`[frontpaper]`, message);
  });

  frontpaperWindow.once("ready-to-show", () => {
    frontpaperWindow!.show();
    console.log(`[forever-papere] Frontpaper overlay shown: ${workArea.width}x${workArea.height}`);
  });

  frontpaperWindow.on("closed", () => { frontpaperWindow = null; });
}

// ── Wallpaper windows (one per monitor) ─────────────────────
function createWallpaperWindow() {
  const displays = screen.getAllDisplays();
  let readyCount = 0;

  console.log(`[forever-papere] Found ${displays.length} display(s)`);

  // Compute virtual screen origin (min x, min y across all displays)
  let vsMinX = Infinity, vsMinY = Infinity;
  for (const d of displays) {
    vsMinX = Math.min(vsMinX, d.bounds.x);
    vsMinY = Math.min(vsMinY, d.bounds.y);
  }

  for (let i = 0; i < displays.length; i++) {
    const display = displays[i];
    const b = display.bounds;
    // Relative position within WorkerW (which spans the virtual screen)
    const relX = b.x - vsMinX;
    const relY = b.y - vsMinY;
    console.log(`[forever-papere] Display ${i}: ${b.width}x${b.height} at (${b.x},${b.y}) sf=${display.scaleFactor} relPos=(${relX},${relY})`);

    const win = new BrowserWindow({
      width: b.width, height: b.height,
      x: b.x, y: b.y,
      frame: false,
      skipTaskbar: true,
      resizable: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: false,
      },
    });

    win.loadFile(path.join(__dirname, "..", "..", "index.html"));

    win.webContents.on("console-message", (_e, _level, message) => {
      console.log(`[renderer:${i}]`, message);
    });

    win.once("ready-to-show", () => {
      win.show();
      const hwndBuffer = win.getNativeWindowHandle();
      try {
        // Pass PHYSICAL pixel coordinates (like .NET Bounds) — WorkerW uses physical pixels
        const sf = display.scaleFactor || 1;
        const physW = Math.round(b.width * sf);
        const physH = Math.round(b.height * sf);
        const physX = Math.round(b.x * sf);
        const physY = Math.round(b.y * sf);
        console.log(`[forever-papere] Display ${i} physical: ${physW}x${physH} at (${physX},${physY})`);
        const success = getNative().attach(hwndBuffer, physW, physH, physX, physY);
        if (success) console.log(`[forever-papere] Wallpaper attached on display ${i}!`);
      } catch (err) {
        console.error(`[forever-papere] Failed to attach on display ${i}:`, err);
      }

      readyCount++;
      if (readyCount === displays.length) {
        if (hasSeenIntro()) {
          // Skip VN chatbox, go straight to mascot
          createMascotWindow();
        } else {
          createChatboxWindow();
        }
      }
    });

    win.on("closed", () => {
      wallpaperWindows = wallpaperWindows.filter(w => w !== win);
    });

    wallpaperWindows.push(win);
  }
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

// ── Mascot widget (persistent character + chat) ─────────
let mascotWindow: BrowserWindow | null = null;
let mascotChatHistory: { role: string; content: string }[] = [];

const MASCOT_SPRITE_SIZE = 120;
const MASCOT_CHAT_WIDTH = 320;
const MASCOT_COLLAPSED_HEIGHT = MASCOT_SPRITE_SIZE + 12;
const MASCOT_EXPANDED_HEIGHT = MASCOT_SPRITE_SIZE + 200;
const MASCOT_MARGIN = 10;

function getMascotBounds(expanded: boolean) {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const w = expanded ? MASCOT_CHAT_WIDTH + 12 : MASCOT_SPRITE_SIZE + 12;
  const h = expanded ? MASCOT_EXPANDED_HEIGHT : MASCOT_COLLAPSED_HEIGHT;
  return {
    x: screenW - w - MASCOT_MARGIN,
    y: screenH - h - MASCOT_MARGIN,
    width: w,
    height: h,
  };
}

function createMascotWindow() {
  if (mascotWindow && !mascotWindow.isDestroyed()) return;

  const bounds = getMascotBounds(false);
  mascotWindow = new BrowserWindow({
    ...bounds,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, "mascot-preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
  });

  mascotWindow.loadFile(path.join(__dirname, "..", "..", "mascot.html"));
  mascotWindow.webContents.on("console-message", (_e, _level, message) => {
    console.log("[mascot-renderer]", message);
  });
  mascotWindow.once("ready-to-show", () => {
    mascotWindow?.show();
    console.log("[mascot] Window shown");
  });
  mascotWindow.on("closed", () => { mascotWindow = null; });
}

// Chat with OpenRouter
async function handleMascotChat(userMessage: string) {
  if (!mascotWindow || mascotWindow.isDestroyed()) return;
  if (!hasOpenRouterKey()) {
    mascotWindow.webContents.send("mascot-chat-error", "No OpenRouter key set. Add one in tray settings.");
    return;
  }

  // Get character info
  const firstImage = getAllMedia("image", "uploaded")[0];
  const charName = firstImage?.character_id
    ? (getAllMedia().find(m => m.character_id === firstImage.character_id) ? "Character" : "Character")
    : "Character";

  // Build system prompt
  if (mascotChatHistory.length === 0) {
    mascotChatHistory.push({
      role: "system",
      content: `You are ${charName}, a friendly anime character who lives on the user's desktop as a mascot. You are cheerful, helpful, and speak in short casual messages (1-3 sentences max). You can chat about anything. Be playful and expressive.`,
    });
  }

  mascotChatHistory.push({ role: "user", content: userMessage });

  // Keep history manageable (last 20 messages + system)
  if (mascotChatHistory.length > 22) {
    mascotChatHistory = [mascotChatHistory[0], ...mascotChatHistory.slice(-20)];
  }

  try {
    const apiKey = getOpenRouterKey();
    console.log("[mascot] Sending chat, key length:", apiKey.length, "history:", mascotChatHistory.length);

    const body = JSON.stringify({
      model: "openrouter/free",
      messages: mascotChatHistory,
      max_tokens: 200,
    });

    const res = await net.fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body,
    });

    const responseData = await res.json();
    console.log("[mascot] Response status:", res.status, "ok:", res.ok);

    if (!res.ok) {
      throw new Error(`API error ${res.status}: ${JSON.stringify(responseData)}`);
    }

    const reply = responseData?.choices?.[0]?.message?.content || "...";
    console.log("[mascot] Reply:", reply.slice(0, 100));
    mascotChatHistory.push({ role: "assistant", content: reply });

    if (mascotWindow && !mascotWindow.isDestroyed()) {
      mascotWindow.webContents.send("mascot-chat-response", reply);
    }
  } catch (err: any) {
    console.error("[mascot] Chat error:", err.message);
    if (mascotWindow && !mascotWindow.isDestroyed()) {
      mascotWindow.webContents.send("mascot-chat-error", "Chat error: " + err.message);
    }
  }
}

// ── IPC ──────────────────────────────────────────────────────
ipcMain.on("mascot-get-config", (event) => {
  const firstImage = getAllMedia("image", "uploaded")[0];
  const spriteFile = firstImage ? path.basename(firstImage.filepath) : "";
  event.returnValue = {
    imagesDir: IMAGES_DIR,
    spriteFile,
    characterName: "Character",
  };
});

ipcMain.on("mascot-toggle-chat", (_e, open: boolean) => {
  if (!mascotWindow || mascotWindow.isDestroyed()) return;
  const bounds = getMascotBounds(open);
  mascotWindow.setBounds(bounds);
});

ipcMain.on("mascot-send-chat", (_e, message: string) => {
  handleMascotChat(message);
});

ipcMain.on("chatbox-dismiss", () => {
  if (chatboxWindow && !chatboxWindow.isDestroyed()) {
    chatboxWindow.close();
  }
  // Mark intro as complete so it doesn't show again
  markIntroSeen();
  // Show mascot when VN chatbox dismisses
  createMascotWindow();
});

ipcMain.on("chatbox-reshow", () => {
  createChatboxWindow();
});

// ── Dev vs production paths ──────────────────────────────────
const isDev = !app.isPackaged;

// ── First-launch migration ───────────────────────────────────
// Dev: copies from src/images + src/videos into %APPDATA%/media/
// Prod: copies from bundled/images + bundled/videos into %APPDATA%/media/
function migrateBundledMedia() {
  // Skip if DB already has entries (not first launch)
  const existing = getAllMedia();
  if (existing.length > 0) {
    console.log("[forever-papere] Media DB has entries, skipping migration");
    return;
  }

  const bundledVideos = isDev
    ? path.join(__dirname, "..", "..", "src", "videos")
    : path.join(__dirname, "..", "..", "bundled", "videos");
  const bundledImages = isDev
    ? path.join(__dirname, "..", "..", "src", "images")
    : path.join(__dirname, "..", "..", "bundled", "images");

  console.log(`[forever-papere] First launch — migrating from ${isDev ? "src/" : "bundled/"}...`);

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
  const record = getDefaultWallpaper();
  const videoFile = record?.filepath || "";
  console.log(`[forever-papere] Wallpaper: ${videoFile || "none (particles)"}`);
  event.returnValue = { videosDir: VIDEOS_DIR, videoFile };
});

ipcMain.on("chatbox-get-config", (event) => {
  // Find the first character sprite in the DB
  const firstImage = getAllMedia("image", "uploaded")[0];
  const spriteFile = firstImage ? path.basename(firstImage.filepath) : "";

  event.returnValue = {
    position: chatboxPosition,
    imagesDir: IMAGES_DIR,
    spriteFile,
  };
});

// ── OpenRouter Auth ───────────────────────────────────────
let apikeyWindow: BrowserWindow | null = null;

async function doOpenRouterAuth() {
  try {
    console.log("[openrouter] Starting OAuth flow...");
    const key = await startOAuthFlow();
    console.log("[openrouter] Authenticated! Key length:", key.length);
    rebuildTrayMenu();
  } catch (err: any) {
    console.error("[openrouter] OAuth failed:", err.message);
  }
}

// ── OpenRouter API Key Dialog (manual fallback) ──────────
let openrouterKeyWindow: BrowserWindow | null = null;

function openOpenRouterKeyDialog() {
  if (openrouterKeyWindow && !openrouterKeyWindow.isDestroyed()) { openrouterKeyWindow.focus(); return; }
  openrouterKeyWindow = new BrowserWindow({
    width: 400, height: 200, frame: false, resizable: false,
    alwaysOnTop: true, skipTaskbar: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  openrouterKeyWindow.loadFile(path.join(__dirname, "..", "..", "openrouter-key-dialog.html"));
  openrouterKeyWindow.on("closed", () => { openrouterKeyWindow = null; });
}

// ── xAI API Key Dialog ───────────────────────────────────
function openXaiKeyDialog() {
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
  // Need at least one provider authenticated
  if (!hasOpenRouterKey() && !hasXaiKey()) { openOpenRouterKeyDialog(); return; }
  if (promptWindow && !promptWindow.isDestroyed()) { promptWindow.focus(); return; }
  promptWindow = new BrowserWindow({
    width: 480, height: 560, frame: false, resizable: false,
    alwaysOnTop: true, skipTaskbar: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
  });
  promptWindow.loadFile(path.join(__dirname, "..", "..", "prompt-dialog.html"));
  promptWindow.on("closed", () => { promptWindow = null; });
}

// Tell the wallpaper renderer to reload with a new media file
function reloadWallpaper(filePath: string) {
  const fileUrl = `file:///${filePath.replace(/\\/g, "/")}`;
  for (const win of wallpaperWindows) {
    if (!win.isDestroyed()) {
      win.webContents.send("wallpaper-reload", fileUrl);
    }
  }
  console.log(`[forever-papere] Reloading wallpaper on ${wallpaperWindows.length} display(s):`, fileUrl);
}

// ── IPC handlers ─────────────────────────────────────────
ipcMain.on("openrouter-key-save", (_e, key: string) => {
  saveOpenRouterKey(key);
  if (openrouterKeyWindow && !openrouterKeyWindow.isDestroyed()) openrouterKeyWindow.close();
  rebuildTrayMenu();
  console.log("[forever-papere] OpenRouter API key saved");
});

ipcMain.on("openrouter-key-cancel", () => {
  if (openrouterKeyWindow && !openrouterKeyWindow.isDestroyed()) openrouterKeyWindow.close();
});

ipcMain.on("apikey-save", (_e, key: string) => {
  saveXaiKey(key);
  if (apikeyWindow && !apikeyWindow.isDestroyed()) apikeyWindow.close();
  rebuildTrayMenu();
  console.log("[forever-papere] xAI API key saved");
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
  const primary = screen.getPrimaryDisplay();
  const detectedAspect = detectAspectRatio(primary.bounds.width, primary.bounds.height);
  event.returnValue = {
    imagesDir: IMAGES_DIR,
    characterImages,
    detectedAspect,
    hasOpenRouter: hasOpenRouterKey(),
    hasXai: hasXaiKey(),
  };
});

ipcMain.on("prompt-submit", async (_e, opts: {
  prompt: string; type: string; source: string; aspectRatio: string;
  duration: number; resolution: string; provider: string;
}) => {
  isGenerating = true;
  let sourceImagePath: string | undefined;
  let sourceImageId: number | undefined;
  let characterId: number | undefined;

  if (opts.source === "character") {
    const firstImage = getAllMedia("image", "uploaded")[0];
    if (firstImage) {
      sourceImagePath = firstImage.filepath;
      sourceImageId = firstImage.id;
      characterId = firstImage.character_id || undefined;
    }
  }

  const sendStatus = (msg: string) => {
    if (promptWindow && !promptWindow.isDestroyed()) promptWindow.webContents.send("generation-status", msg);
  };

  try {
    let result;

    if (opts.provider === "xai") {
      // ── xAI: supports both image and video ──
      if (opts.type === "video" && sourceImagePath) {
        result = await generateCharacterVideo({
          prompt: opts.prompt,
          duration: opts.duration,
          aspectRatio: opts.aspectRatio,
          resolution: opts.resolution,
          sourceImagePath,
          sourceImageId,
          characterId,
        }, sendStatus);
      } else if (opts.type === "video") {
        sendStatus("Generating video... this may take several minutes.");
        result = await generateVideo({
          prompt: opts.prompt,
          duration: opts.duration,
          aspectRatio: opts.aspectRatio,
          resolution: opts.resolution,
        });
      } else {
        sendStatus(sourceImagePath ? "Generating image from character..." : "Generating image...");
        result = await xaiGenerateImage({
          prompt: opts.prompt,
          aspectRatio: opts.aspectRatio,
          sourceImagePath,
          sourceImageId,
          characterId,
        });
      }
    } else {
      // ── OpenRouter: image generation only ──
      if (sourceImagePath) {
        result = await generateCharacterWallpaper({
          prompt: opts.prompt,
          aspectRatio: opts.aspectRatio,
          imageSize: "2K",
          sourceImagePath,
          sourceImageId,
          characterId,
        }, sendStatus);
      } else {
        sendStatus("Generating wallpaper...");
        result = await orGenerateImage({
          prompt: opts.prompt,
          aspectRatio: opts.aspectRatio,
          imageSize: "2K",
        });
      }
    }

    if (result.success && result.filePath) {
      if (promptWindow) promptWindow.webContents.send("generation-success", "Done! Applying as wallpaper...");
      reloadWallpaper(result.filePath);
    } else {
      if (promptWindow) promptWindow.webContents.send("generation-error", result.error || "Unknown error");
    }
  } catch (err: any) {
    console.error("[generation] Error:", err);
    if (promptWindow) promptWindow.webContents.send("generation-error", err.message || "Generation failed");
  } finally {
    isGenerating = false;
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
      label: "Generate Wallpaper",
      click: () => openPromptDialog(),
    },
    { type: "separator" },
    { label: "Providers", enabled: false },
    {
      label: hasOpenRouterKey() ? "OpenRouter ✓ (paste key)" : "Set OpenRouter Key",
      click: () => openOpenRouterKeyDialog(),
    },
    {
      label: "Sign in with OpenRouter (OAuth)",
      click: () => doOpenRouterAuth(),
    },
    {
      label: hasXaiKey() ? "xAI ✓" : "Set xAI API Key",
      click: () => openXaiKeyDialog(),
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

// createTrayIconBuffer imported from ./utils

// ── Auto-generation ─────────────────────────────────────────
const AUTO_GEN_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
let autoGenTimer: ReturnType<typeof setInterval> | null = null;
let isGenerating = false;

async function autoGenerate() {
  if (!hasOpenRouterKey() && !hasXaiKey()) {
    console.log("[auto-gen] No providers configured, skipping.");
    return;
  }
  if (isGenerating) {
    console.log("[auto-gen] Already generating, skipping.");
    return;
  }

  isGenerating = true;
  console.log("[auto-gen] Starting auto-generation...");

  try {
    const firstImage = getAllMedia("image", "uploaded")[0];
    const sourceImagePath = firstImage?.filepath;
    const sourceImageId = firstImage?.id;
    const characterId = firstImage?.character_id || undefined;

    const lofiPrompts = [
      "The character sitting at a cozy desk in a warm, softly-lit study room, lo-fi anime aesthetic. Books, plants, a desk lamp glowing warmly, headphones on, studying peacefully. Warm color palette, gentle ambient lighting, studio ghibli inspired cozy atmosphere",
      "The character relaxing by a rain-streaked window at night, lo-fi anime style. Warm interior lighting, a cup of tea steaming, bookshelves in background, city lights visible through rain. Calm, peaceful mood",
      "The character at a rooftop garden at golden hour, lo-fi anime aesthetic. Plants, fairy lights, a small table with art supplies, warm sunset colors, gentle breeze effect. Serene and dreamy atmosphere",
      "The character in a cozy cafe corner, lo-fi anime style. Warm lighting, pastries and coffee on the table, rain outside the window, vintage decor. Peaceful and inviting atmosphere",
      "The character in a moonlit library, lo-fi anime aesthetic. Towering bookshelves, floating dust motes in soft light, a reading lamp, starry sky visible through a window. Magical and tranquil",
    ];
    const prompt = lofiPrompts[Math.floor(Math.random() * lofiPrompts.length)];

    // Detect primary display aspect ratio for generation
    const primary = screen.getPrimaryDisplay();
    const aspectRatio = detectAspectRatio(primary.bounds.width, primary.bounds.height);
    console.log(`[auto-gen] Primary display: ${primary.bounds.width}x${primary.bounds.height} → aspect ${aspectRatio}`);

    let result;
    const useXai = hasXaiKey();
    const useOpenRouter = hasOpenRouterKey();

    if (useXai && sourceImagePath) {
      // xAI: two-step character video
      console.log("[auto-gen] Using xAI for character video");
      result = await generateCharacterVideo({
        prompt,
        duration: 5,
        aspectRatio,
        resolution: "1080p",
        sourceImagePath,
        sourceImageId,
        characterId,
      }, (msg) => console.log("[auto-gen]", msg));
    } else if (useXai) {
      // xAI: text-to-video
      console.log("[auto-gen] Using xAI for text-to-video");
      result = await generateVideo({
        prompt,
        duration: 5,
        aspectRatio,
        resolution: "1080p",
      });
    } else if (useOpenRouter && sourceImagePath) {
      // OpenRouter: character image wallpaper
      console.log("[auto-gen] Using OpenRouter for character wallpaper");
      result = await generateCharacterWallpaper({
        prompt,
        aspectRatio,
        imageSize: "2K",
        sourceImagePath,
        sourceImageId,
        characterId,
      }, (msg) => console.log("[auto-gen]", msg));
    } else if (useOpenRouter) {
      // OpenRouter: text-to-image
      console.log("[auto-gen] Using OpenRouter for text-to-image");
      result = await orGenerateImage({
        prompt,
        aspectRatio,
        imageSize: "2K",
      });
    } else {
      console.log("[auto-gen] No providers configured, skipping.");
      return;
    }

    if (result.success && result.filePath) {
      console.log("[auto-gen] Done! Applying wallpaper:", result.filePath);
      reloadWallpaper(result.filePath);
    } else {
      console.error("[auto-gen] Failed:", result.error);
    }
  } catch (err: any) {
    console.error("[auto-gen] Error:", err.message);
  } finally {
    isGenerating = false;
  }
}

function startAutoGeneration() {
  // Generate on startup (small delay to let wallpaper window init)
  setTimeout(() => autoGenerate(), 5000);
  // Then every 30 minutes
  autoGenTimer = setInterval(() => autoGenerate(), AUTO_GEN_INTERVAL_MS);
  console.log("[auto-gen] Scheduled: on startup + every 30 minutes.");
}

// ── Periodic screen commentary ──────────────────────────────
let screenCommentTimer: ReturnType<typeof setTimeout> | null = null;
const SCREEN_COMMENT_MIN_MS = 45 * 60 * 1000;  // 45 min
const SCREEN_COMMENT_MAX_MS = 120 * 60 * 1000;  // 2 hours

function nextCommentDelay(): number {
  return SCREEN_COMMENT_MIN_MS + Math.random() * (SCREEN_COMMENT_MAX_MS - SCREEN_COMMENT_MIN_MS);
}

async function captureAndComment() {
  const orKey = getOpenRouterKey();
  if (!orKey) {
    console.log("[screen-comment] No OpenRouter key, skipping");
    scheduleNextComment();
    return;
  }
  if (!mascotWindow || mascotWindow.isDestroyed()) {
    console.log("[screen-comment] No mascot window, skipping");
    scheduleNextComment();
    return;
  }

  try {
    console.log("[screen-comment] Capturing screen...");
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1280, height: 720 },
    });

    if (sources.length === 0) {
      console.log("[screen-comment] No screen sources found");
      scheduleNextComment();
      return;
    }

    const source = sources[0];
    const thumbnail = source.thumbnail;
    const jpegBuffer = thumbnail.toJPEG(70);
    const b64 = jpegBuffer.toString("base64");
    const dataUri = `data:image/jpeg;base64,${b64}`;
    console.log(`[screen-comment] Screenshot captured: ${jpegBuffer.length} bytes`);

    // Send to OpenRouter with vision
    const characterName = (() => {
      const firstImage = getAllMedia("image", "uploaded")[0];
      if (firstImage?.character_id) {
        const db = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA || ".", "ForeverPapere", "media.json"), "utf-8"));
        const char = db.characters?.find((c: any) => c.id === firstImage.character_id);
        if (char) return char.name;
      }
      return "Character";
    })();

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${orKey}`,
        "HTTP-Referer": "https://github.com/RyugaLDragoMeteor/ForeverPapere",
        "X-Title": "ForeverPapere",
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-exp:free",
        messages: [
          {
            role: "system",
            content: `You are ${characterName}, a friendly desktop companion. You can see the user's screen. Make a brief, casual comment (1-2 sentences) about what they're doing. Be playful, encouraging, or mildly sarcastic. Don't be annoying or repetitive. Keep it short and natural, like a friend glancing at your screen.`,
          },
          {
            role: "user",
            content: [
              { type: "text", text: "What do you think about what I'm doing?" },
              { type: "image_url", image_url: { url: dataUri } },
            ],
          },
        ],
        max_tokens: 100,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.log(`[screen-comment] API error ${response.status}: ${err}`);
      scheduleNextComment();
      return;
    }

    const data = await response.json();
    const comment = data.choices?.[0]?.message?.content?.trim();
    if (comment && mascotWindow && !mascotWindow.isDestroyed()) {
      console.log(`[screen-comment] AI says: ${comment}`);
      mascotWindow.webContents.send("mascot-screen-comment", comment);
    }
  } catch (err) {
    console.error("[screen-comment] Error:", err);
  }

  scheduleNextComment();
}

function scheduleNextComment() {
  const delay = nextCommentDelay();
  const mins = Math.round(delay / 60000);
  console.log(`[screen-comment] Next comment in ~${mins} minutes`);
  screenCommentTimer = setTimeout(() => captureAndComment(), delay);
}

function startScreenCommentary() {
  // First comment after 2-5 minutes
  const initialDelay = (2 + Math.random() * 3) * 60 * 1000;
  console.log(`[screen-comment] First comment in ~${Math.round(initialDelay / 60000)} minutes`);
  screenCommentTimer = setTimeout(() => captureAndComment(), initialDelay);
}

// ── Cleanup ──────────────────────────────────────────────────
function cleanup() {
  console.log("[forever-papere] Cleaning up...");
  if (autoGenTimer) { clearInterval(autoGenTimer); autoGenTimer = null; }
  if (screenCommentTimer) { clearTimeout(screenCommentTimer); screenCommentTimer = null; }
  try { getNative().detach(); } catch (_) {}
  try { getNative().reset(); } catch (_) {}
  try { closeDb(); } catch (_) {}
  for (const win of wallpaperWindows) {
    if (!win.isDestroyed()) win.close();
  }
  wallpaperWindows = [];
  if (chatboxWindow && !chatboxWindow.isDestroyed()) chatboxWindow.close();
  if (frontpaperWindow && !frontpaperWindow.isDestroyed()) frontpaperWindow.close();
  if (tray) { tray.destroy(); tray = null; }
}

// ── Single instance: newest takes over ───────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Another instance is already running — it will receive 'second-instance'
  // and quit itself, then we relaunch
  console.log("[forever-papere] Another instance detected, waiting for it to quit...");
  setTimeout(() => {
    app.relaunch();
    app.exit(0);
  }, 1500);
} else {
  // We have the lock — if a newer instance launches, quit ourselves
  app.on("second-instance", () => {
    console.log("[forever-papere] Newer instance detected, yielding...");
    cleanup();
    app.quit();
  });
}

// ── App lifecycle ────────────────────────────────────────────
app.on("ready", () => {
  migrateBundledMedia();
  createTray();
  createWallpaperWindow();
  createFrontpaperWindow();

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

  startAutoGeneration();
  startScreenCommentary();
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
