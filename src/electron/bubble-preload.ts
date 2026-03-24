import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("bubbleAPI", {
  close: () => ipcRenderer.send("bubble-close"),
});
