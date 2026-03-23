// ForeverPapere — Background renderer
// Plays video or shows image on canvas. No particle fallback.

const canvas = document.getElementById("bg") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
let W = 0, H = 0;

function resize() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
}
resize();
window.addEventListener("resize", resize);

// ── Load media ──────────────────────────────────────────────
let currentAnimFrame: number | null = null;
let currentVideo: HTMLVideoElement | null = null;

function loadMedia(url: string) {
  // Stop previous video and animation
  if (currentAnimFrame !== null) cancelAnimationFrame(currentAnimFrame);
  if (currentVideo) {
    currentVideo.pause();
    currentVideo.removeAttribute("src");
    currentVideo = null;
  }

  const isVideo = /\.(mp4|webm|mkv|mov|avi)(\?|$)/i.test(url);
  const isImage = /\.(png|jpg|jpeg|webp|gif|bmp)(\?|$)/i.test(url);

  if (isVideo) {
    console.log("[wallpaper] Loading video:", url);
    const video = document.createElement("video");
    video.src = url;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;

    video.addEventListener("error", () => {
      console.log("[wallpaper] Video error, showing black");
    });

    video.play().then(() => {
      console.log("[wallpaper] Video playing, rendering to canvas");
      currentVideo = video;
      startVideoLoop(video);
    }).catch((err) => {
      console.log("[wallpaper] Video play failed:", err);
    });
  } else if (isImage) {
    console.log("[wallpaper] Loading image:", url);
    const img = new Image();
    img.onload = () => {
      const ia = img.width / img.height;
      const ca = W / H;
      let dw: number, dh: number, dx: number, dy: number;
      if (ca > ia) { dw = W; dh = W / ia; dx = 0; dy = (H - dh) / 2; }
      else { dh = H; dw = H * ia; dx = (W - dw) / 2; dy = 0; }
      ctx.drawImage(img, dx, dy, dw, dh);
    };
    img.onerror = () => {
      console.log("[wallpaper] Image error");
    };
    img.src = url;
  } else {
    console.log("[wallpaper] Unknown media type:", url);
  }
}

const videoUrl = (window as any).wallpaperConfig?.videoFile;
if (videoUrl) {
  loadMedia(videoUrl);
} else {
  console.log("[wallpaper] No media configured");
}

// ── Hot-reload from generation ──────────────────────────────
const ipc = (window as any).wallpaperIPC;
if (ipc?.onReload) {
  ipc.onReload((url: string) => {
    console.log("[wallpaper] Hot-reloading:", url);
    loadMedia(url);
  });
}

// ── Video loop ───────────────────────────────────────────────
function startVideoLoop(video: HTMLVideoElement) {
  function drawFrame() {
    if (video.readyState >= 2) {
      const va = video.videoWidth / video.videoHeight;
      const ca = W / H;
      let dw: number, dh: number, dx: number, dy: number;
      if (ca > va) { dw = W; dh = W / va; dx = 0; dy = (H - dh) / 2; }
      else { dh = H; dw = H * va; dx = (W - dw) / 2; dy = 0; }
      ctx.drawImage(video, dx, dy, dw, dh);
    }
    currentAnimFrame = requestAnimationFrame(drawFrame);
  }
  drawFrame();
}
