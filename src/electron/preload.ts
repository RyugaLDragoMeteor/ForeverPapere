import { contextBridge, ipcRenderer } from "electron";

// Get the videos directory and first available video from main process
const config = ipcRenderer.sendSync("wallpaper-get-config");

contextBridge.exposeInMainWorld("wallpaperConfig", {
  videosDir: config.videosDir,
  videoFile: config.videoFile,
});

// If a video file was found, set it on the video element once DOM loads
window.addEventListener("DOMContentLoaded", () => {
  if (config.videoFile) {
    const video = document.getElementById("bgVideo") as HTMLVideoElement;
    const canvas = document.getElementById("bg") as HTMLCanvasElement;
    if (video) {
      video.src = config.videoFile;
      video.style.display = "block";
      canvas.style.display = "none";
      video.play().catch(() => {
        // Video failed to play, renderer will fall back to canvas
        video.style.display = "none";
        canvas.style.display = "block";
      });
    }
  }
});
