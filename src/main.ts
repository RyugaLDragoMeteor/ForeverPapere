// ForeverPapere — Background renderer
// Plays video on canvas, or falls back to particle animation.

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
      console.log("[wallpaper] Video error, falling back to particles");
      startParticles();
    });

    video.play().then(() => {
      console.log("[wallpaper] Video playing, rendering to canvas");
      currentVideo = video;
      startVideoLoop(video);
    }).catch((err) => {
      console.log("[wallpaper] Video play failed:", err);
      startParticles();
    });
  } else if (isImage) {
    console.log("[wallpaper] Loading image:", url);
    const img = new Image();
    img.onload = () => {
      // Cover-fit image
      const ia = img.width / img.height;
      const ca = W / H;
      let dw: number, dh: number, dx: number, dy: number;
      if (ca > ia) { dw = W; dh = W / ia; dx = 0; dy = (H - dh) / 2; }
      else { dh = H; dw = H * ia; dx = (W - dw) / 2; dy = 0; }
      ctx.drawImage(img, dx, dy, dw, dh);
    };
    img.onerror = () => {
      console.log("[wallpaper] Image error, falling back to particles");
      startParticles();
    };
    img.src = url;
  } else {
    console.log("[wallpaper] Unknown media type, using particles");
    startParticles();
  }
}

const videoUrl = (window as any).wallpaperConfig?.videoFile;
if (videoUrl) {
  loadMedia(videoUrl);
} else {
  console.log("[wallpaper] No video, using particles");
  startParticles();
}

// ── Hot-reload from xAI generation ──────────────────────────
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

// ── Particle fallback ────────────────────────────────────────
function startParticles() {
  const PARTICLE_COUNT = 180;
  const CONNECTION_DIST = 140;
  const MOUSE_RADIUS = 200;
  const BASE_SPEED = 0.4;
  const MOUSE_PUSH = 0.06;
  const HUE_SHIFT_SPEED = 0.015;

  interface Particle {
    x: number; y: number; vx: number; vy: number;
    radius: number; hue: number;
  }

  let mouseX = -9999, mouseY = -9999, mouseDown = false, globalHue = 0;
  const particles: Particle[] = [];

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const a = Math.random() * Math.PI * 2;
    particles.push({
      x: Math.random() * W, y: Math.random() * H,
      vx: Math.cos(a) * BASE_SPEED, vy: Math.sin(a) * BASE_SPEED,
      radius: 1.5 + Math.random() * 2, hue: Math.random() * 360,
    });
  }

  window.addEventListener("mousemove", (e) => { mouseX = e.clientX; mouseY = e.clientY; });
  window.addEventListener("mousedown", () => (mouseDown = true));
  window.addEventListener("mouseup", () => (mouseDown = false));
  window.addEventListener("mouseleave", () => { mouseX = -9999; mouseY = -9999; });

  function loop() {
    globalHue = (globalHue + HUE_SHIFT_SPEED) % 360;
    for (const p of particles) {
      const dx = p.x - mouseX, dy = p.y - mouseY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < MOUSE_RADIUS && dist > 0) {
        const force = (1 - dist / MOUSE_RADIUS) * (mouseDown ? MOUSE_PUSH * 4 : MOUSE_PUSH);
        p.vx += (dx / dist) * force; p.vy += (dy / dist) * force;
      }
      p.vx += (W / 2 - p.x) * 0.00002; p.vy += (H / 2 - p.y) * 0.00002;
      p.vx *= 0.998; p.vy *= 0.998; p.x += p.vx; p.y += p.vy;
      if (p.x < -10) p.x = W + 10; if (p.x > W + 10) p.x = -10;
      if (p.y < -10) p.y = H + 10; if (p.y > H + 10) p.y = -10;
      p.hue = (p.hue + HUE_SHIFT_SPEED * 10) % 360;
    }

    ctx.fillStyle = "rgba(10, 10, 26, 0.15)";
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const a = particles[i], b = particles[j];
        const dx = a.x - b.x, dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < CONNECTION_DIST) {
          const alpha = 1 - dist / CONNECTION_DIST;
          ctx.strokeStyle = `hsla(${(a.hue + globalHue) % 360}, 80%, 60%, ${alpha * 0.35})`;
          ctx.lineWidth = alpha * 1.5;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
      }
    }
    for (const p of particles) {
      const hue = (p.hue + globalHue) % 360;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${hue}, 90%, 65%, 0.9)`; ctx.fill();
      ctx.beginPath(); ctx.arc(p.x, p.y, p.radius * 3, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${hue}, 90%, 65%, 0.08)`; ctx.fill();
    }
    currentAnimFrame = requestAnimationFrame(loop);
  }
  loop();
}
