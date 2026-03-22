import { contextBridge, ipcRenderer } from "electron";

const config = ipcRenderer.sendSync("mascot-get-config");

contextBridge.exposeInMainWorld("mascotAPI", {
  getConfig: () => config,
  toggleChat: (open: boolean) => ipcRenderer.send("mascot-toggle-chat", open),
  sendChat: (message: string) => ipcRenderer.send("mascot-send-chat", message),
  onResponse: (cb: (text: string) => void) => {
    ipcRenderer.on("mascot-chat-response", (_e, text) => cb(text));
  },
  onError: (cb: (text: string) => void) => {
    ipcRenderer.on("mascot-chat-error", (_e, text) => cb(text));
  },
});
