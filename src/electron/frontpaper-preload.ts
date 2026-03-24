import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("frontpaperAPI", {
  removeChatbox: (id: string) => ipcRenderer.send("frontpaper-remove-chatbox", id),
});
