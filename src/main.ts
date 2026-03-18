// ForeverPapere — Background renderer
// Tries to play a video from src/videos/. Falls back to particle canvas if none found.

declare global {
  interface Window {
    wallpaperConfig?: { videosDir: string };
  }
}

const video = document.getElementById("bgVideo") as HTMLVideoElement;
const canvas = document.getElementById("bg") as HTMLCanvasElement;

// ── Try loading video ────────────────────────────────────────
function tryLoadVideo() {
  const videosDir = window.wallpaperConfig?.videosDir || "src/videos";

  // Try common video formats
  const formats = [".mp4", ".webm", ".mkv", ".mov"];

  // We'll use a fetch probe to find the first available video file.
  // Since we're in Electron loading local files, we try known filenames.
  // The preload script provides the actual files list via IPC.
  // Fallback: just try to load any video source set by the preload.
  if (video.src && video.src !== window.location.href) {
    video.play().catch(() => fallbackToCanvas());
    return;
  }

  // No video source set — fall back to canvas
  fallbackToCanvas();
}

function fallbackToCanvas() {
  video.style.display = "none";
  canvas.style.display = "block";
  initCanvas();
}

// ── Particle canvas (fallback) ───────────────────────────────
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

let ctx: CanvasRenderingContext2D;
let W = 0, H = 0;
let mouseX = -9999, mouseY = -9999;
let mouseDown = false;
let globalHue = 0;
const particles: Particle[] = [];

function initCanvas() {
  ctx = canvas.getContext("2d")!;
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;

  particles.length = 0;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    particles.push({
      x: Math.random() * W, y: Math.random() * H,
      vx: Math.cos(angle) * BASE_SPEED, vy: Math.sin(angle) * BASE_SPEED,
      radius: 1.5 + Math.random() * 2, hue: Math.random() * 360,
    });
  }

  window.addEventListener("resize", () => {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  });

  loop();
}

function update() {
  globalHue = (globalHue + HUE_SHIFT_SPEED) % 360;
  for (const p of particles) {
    const dx = p.x - mouseX, dy = p.y - mouseY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < MOUSE_RADIUS && dist > 0) {
      const force = (1 - dist / MOUSE_RADIUS) * (mouseDown ? MOUSE_PUSH * 4 : MOUSE_PUSH);
      p.vx += (dx / dist) * force;
      p.vy += (dy / dist) * force;
    }
    p.vx += (W / 2 - p.x) * 0.00002;
    p.vy += (H / 2 - p.y) * 0.00002;
    p.vx *= 0.998; p.vy *= 0.998;
    p.x += p.vx; p.y += p.vy;
    if (p.x < -10) p.x = W + 10; if (p.x > W + 10) p.x = -10;
    if (p.y < -10) p.y = H + 10; if (p.y > H + 10) p.y = -10;
    p.hue = (p.hue + HUE_SHIFT_SPEED * 10) % 360;
  }
}

function draw() {
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
  if (mouseX > 0 && mouseY > 0) {
    const grad = ctx.createRadialGradient(mouseX, mouseY, 0, mouseX, mouseY, MOUSE_RADIUS);
    grad.addColorStop(0, `hsla(${(globalHue * 20) % 360}, 100%, 70%, ${mouseDown ? 0.12 : 0.06})`);
    grad.addColorStop(1, "transparent");
    ctx.fillStyle = grad;
    ctx.fillRect(mouseX - MOUSE_RADIUS, mouseY - MOUSE_RADIUS, MOUSE_RADIUS * 2, MOUSE_RADIUS * 2);
  }
  for (const p of particles) {
    const hue = (p.hue + globalHue) % 360;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${hue}, 90%, 65%, 0.9)`; ctx.fill();
    ctx.beginPath(); ctx.arc(p.x, p.y, p.radius * 3, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${hue}, 90%, 65%, 0.08)`; ctx.fill();
  }
}

function loop() { update(); draw(); requestAnimationFrame(loop); }

// ── Mouse/touch events ───────────────────────────────────────
window.addEventListener("mousemove", (e) => { mouseX = e.clientX; mouseY = e.clientY; });
window.addEventListener("mousedown", () => (mouseDown = true));
window.addEventListener("mouseup", () => (mouseDown = false));
window.addEventListener("mouseleave", () => { mouseX = -9999; mouseY = -9999; });
window.addEventListener("touchmove", (e) => { mouseX = e.touches[0].clientX; mouseY = e.touches[0].clientY; });
window.addEventListener("touchstart", (e) => { mouseDown = true; mouseX = e.touches[0].clientX; mouseY = e.touches[0].clientY; });
window.addEventListener("touchend", () => { mouseDown = false; mouseX = -9999; mouseY = -9999; });

// ── Start ────────────────────────────────────────────────────
tryLoadVideo();
