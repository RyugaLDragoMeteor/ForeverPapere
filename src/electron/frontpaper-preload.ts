import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("frontpaperAPI", {
  setHover: (over: boolean) => ipcRenderer.send("frontpaper-hover", over),
  removeChatbox: (id: string) => ipcRenderer.send("frontpaper-remove-chatbox", id),
});
