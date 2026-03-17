// Preload script — exposes minimal API to renderer
import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("wallpaperMambo", {
  isWallpaperMode: true,
});
