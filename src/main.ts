// ── Config ───────────────────────────────────────────────────
const PARTICLE_COUNT = 180;
const CONNECTION_DIST = 140;
const MOUSE_RADIUS = 200;
const BASE_SPEED = 0.4;
const MOUSE_PUSH = 0.06;
const HUE_SHIFT_SPEED = 0.015;

// ── Types ────────────────────────────────────────────────────
interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  hue: number;
}

// ── Setup ────────────────────────────────────────────────────
const canvas = document.getElementById("bg") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

let W = 0;
let H = 0;
let mouseX = -9999;
let mouseY = -9999;
let mouseDown = false;
let globalHue = 0;

const particles: Particle[] = [];

function resize() {
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
}

function createParticle(): Particle {
  const angle = Math.random() * Math.PI * 2;
  return {
    x: Math.random() * W,
    y: Math.random() * H,
    vx: Math.cos(angle) * BASE_SPEED,
    vy: Math.sin(angle) * BASE_SPEED,
    radius: 1.5 + Math.random() * 2,
    hue: Math.random() * 360,
  };
}

function init() {
  resize();
  particles.length = 0;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    particles.push(createParticle());
  }
}

// ── Update ───────────────────────────────────────────────────
function update() {
  globalHue = (globalHue + HUE_SHIFT_SPEED) % 360;

  for (const p of particles) {
    // Mouse interaction
    const dx = p.x - mouseX;
    const dy = p.y - mouseY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < MOUSE_RADIUS && dist > 0) {
      const force = (1 - dist / MOUSE_RADIUS) * (mouseDown ? MOUSE_PUSH * 4 : MOUSE_PUSH);
      p.vx += (dx / dist) * force;
      p.vy += (dy / dist) * force;
    }

    // Slight attraction to center to keep things on screen
    p.vx += (W / 2 - p.x) * 0.00002;
    p.vy += (H / 2 - p.y) * 0.00002;

    // Damping
    p.vx *= 0.998;
    p.vy *= 0.998;

    // Move
    p.x += p.vx;
    p.y += p.vy;

    // Wrap edges
    if (p.x < -10) p.x = W + 10;
    if (p.x > W + 10) p.x = -10;
    if (p.y < -10) p.y = H + 10;
    if (p.y > H + 10) p.y = -10;

    // Shift hue slowly
    p.hue = (p.hue + HUE_SHIFT_SPEED * 10) % 360;
  }
}

// ── Draw ─────────────────────────────────────────────────────
function draw() {
  // Fade trail
  ctx.fillStyle = "rgba(10, 10, 26, 0.15)";
  ctx.fillRect(0, 0, W, H);

  // Connections
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const a = particles[i];
      const b = particles[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < CONNECTION_DIST) {
        const alpha = 1 - dist / CONNECTION_DIST;
        const hue = (a.hue + globalHue) % 360;
        ctx.strokeStyle = `hsla(${hue}, 80%, 60%, ${alpha * 0.35})`;
        ctx.lineWidth = alpha * 1.5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }
  }

  // Mouse glow
  if (mouseX > 0 && mouseY > 0) {
    const grad = ctx.createRadialGradient(mouseX, mouseY, 0, mouseX, mouseY, MOUSE_RADIUS);
    const hue = (globalHue * 20) % 360;
    grad.addColorStop(0, `hsla(${hue}, 100%, 70%, ${mouseDown ? 0.12 : 0.06})`);
    grad.addColorStop(1, "transparent");
    ctx.fillStyle = grad;
    ctx.fillRect(mouseX - MOUSE_RADIUS, mouseY - MOUSE_RADIUS, MOUSE_RADIUS * 2, MOUSE_RADIUS * 2);
  }

  // Particles
  for (const p of particles) {
    const hue = (p.hue + globalHue) % 360;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${hue}, 90%, 65%, 0.9)`;
    ctx.fill();

    // Glow
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius * 3, 0, Math.PI * 2);
    ctx.fillStyle = `hsla(${hue}, 90%, 65%, 0.08)`;
    ctx.fill();
  }
}

// ── Loop ─────────────────────────────────────────────────────
function loop() {
  update();
  draw();
  requestAnimationFrame(loop);
}

// ── Events ───────────────────────────────────────────────────
window.addEventListener("resize", resize);
window.addEventListener("mousemove", (e) => {
  mouseX = e.clientX;
  mouseY = e.clientY;
});
window.addEventListener("mousedown", () => (mouseDown = true));
window.addEventListener("mouseup", () => (mouseDown = false));
window.addEventListener("mouseleave", () => {
  mouseX = -9999;
  mouseY = -9999;
});

// Touch support
window.addEventListener("touchmove", (e) => {
  mouseX = e.touches[0].clientX;
  mouseY = e.touches[0].clientY;
});
window.addEventListener("touchstart", (e) => {
  mouseDown = true;
  mouseX = e.touches[0].clientX;
  mouseY = e.touches[0].clientY;
});
window.addEventListener("touchend", () => {
  mouseDown = false;
  mouseX = -9999;
  mouseY = -9999;
});

// ── Start ────────────────────────────────────────────────────
init();
loop();
