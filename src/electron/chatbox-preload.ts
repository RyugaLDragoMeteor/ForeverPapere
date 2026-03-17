import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("chatboxAPI", {
  dismiss: () => ipcRenderer.send("chatbox-dismiss"),
});
