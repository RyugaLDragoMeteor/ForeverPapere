// VN-style chatbox — typewriter text with character sprite + click-to-advance

declare global {
  interface Window {
    chatboxAPI: {
      dismiss: () => void;
      getConfig: () => { position: string; imagesDir: string };
    };
  }
}

interface DialogueLine {
  name: string;
  text: string;
  sprite?: string; // filename in images dir (or empty to hide sprite)
}

// Get config from main process
const config = window.chatboxAPI?.getConfig() ?? { position: "center", imagesDir: "", spriteFile: "" };
const sprite = config.spriteFile || "";

const script: DialogueLine[] = [
  { name: "System", text: "ForeverPapere is now running.", sprite },
  { name: "System", text: "Your desktop is alive with particles that react to your mouse.", sprite },
  { name: "System", text: "Click and hold anywhere on the desktop for a burst effect.", sprite },
  { name: "System", text: "Press Ctrl+Alt+Q to quit. Ctrl+Alt+H to toggle this chatbox.", sprite },
  { name: "System", text: "Right-click the tray icon to change chatbox position or re-show this box.", sprite },
  { name: "System", text: "Enjoy your new wallpaper!" },
];

const CHAR_DELAY = 30;
const FAST_DELAY = 8;

const textEl = document.getElementById("textContent")!;
const nameEl = document.getElementById("namePlate")!;
const indicatorEl = document.getElementById("continueIndicator")!;
const chatboxEl = document.getElementById("chatbox")!;
const spriteContainer = document.getElementById("characterSprite")!;
const spriteImg = document.getElementById("spriteImg") as HTMLImageElement;

let currentLine = 0;
let isTyping = false;
let skipTyping = false;
let fullText = "";
let charIndex = 0;

// Derive sprite horizontal alignment from chatbox position
function getSpriteAlign(): string {
  const pos = config.position;
  if (pos.includes("left")) return "left";
  if (pos.includes("right")) return "right";
  return "center";
}

function applySpritePosition() {
  spriteContainer.classList.remove("pos-left", "pos-center", "pos-right");
  spriteContainer.classList.add(`pos-${getSpriteAlign()}`);
}

function showSprite(filename?: string) {
  if (!filename) {
    spriteContainer.style.display = "none";
    return;
  }

  const imgPath = `${config.imagesDir}/${filename}`;
  spriteImg.src = imgPath;
  spriteContainer.style.display = "block";
  applySpritePosition();
}

function showLine(line: DialogueLine) {
  nameEl.textContent = line.name;
  fullText = line.text;
  charIndex = 0;
  isTyping = true;
  skipTyping = false;
  indicatorEl.classList.remove("visible");
  textEl.innerHTML = '<span class="cursor"></span>';

  showSprite(line.sprite);
  typeNext();
}

function typeNext() {
  if (charIndex >= fullText.length) {
    isTyping = false;
    textEl.innerHTML = fullText + '<span class="cursor"></span>';
    indicatorEl.classList.add("visible");
    return;
  }

  const delay = skipTyping ? FAST_DELAY : CHAR_DELAY;
  textEl.innerHTML = fullText.slice(0, charIndex + 1) + '<span class="cursor"></span>';
  charIndex++;
  setTimeout(typeNext, delay);
}

function advance() {
  if (isTyping) {
    skipTyping = true;
    return;
  }

  currentLine++;

  if (currentLine >= script.length) {
    // Auto-dismiss after a brief pause
    setTimeout(() => window.chatboxAPI?.dismiss(), 500);
    return;
  }

  showLine(script[currentLine]);
}

// Click to advance
chatboxEl.addEventListener("click", advance);
spriteContainer.addEventListener("click", advance);

// Spacebar / Enter also advance
window.addEventListener("keydown", (e) => {
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    advance();
  }
});

// Apply top/bottom layout
if (config.position.startsWith("top")) {
  document.querySelector(".vn-container")?.classList.add("top-position");
}

// Start
showLine(script[0]);
