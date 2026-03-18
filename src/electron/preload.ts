import { contextBridge, ipcRenderer } from "electron";

const config = ipcRenderer.sendSync("wallpaper-get-config");

// Convert Windows path to file:// URL for Chromium
let videoUrl = "";
if (config.videoFile) {
  videoUrl = "file:///" + config.videoFile.replace(/\\/g, "/");
}

contextBridge.exposeInMainWorld("wallpaperConfig", {
  videosDir: config.videosDir,
  videoFile: videoUrl,
});

// Listen for hot-reload from xAI generation
contextBridge.exposeInMainWorld("wallpaperIPC", {
  onReload: (callback: (url: string) => void) => {
    ipcRenderer.on("wallpaper-reload", (_e, url: string) => callback(url));
  },
});
