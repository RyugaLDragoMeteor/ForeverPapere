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
