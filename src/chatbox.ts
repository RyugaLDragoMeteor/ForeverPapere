// VN-style chatbox — typewriter text with click-to-advance

declare global {
  interface Window {
    chatboxAPI: {
      dismiss: () => void;
    };
  }
}

interface DialogueLine {
  name: string;
  text: string;
}

const script: DialogueLine[] = [
  { name: "System", text: "ForeverPapere is now running." },
  { name: "System", text: "Your desktop is alive with particles that react to your mouse." },
  { name: "System", text: "Click and hold anywhere on the desktop for a burst effect." },
  { name: "System", text: "Press Ctrl+Alt+Q at any time to quit and restore your wallpaper." },
  { name: "System", text: "Right-click the tray icon to change chatbox position or re-show this box." },
  { name: "System", text: "Enjoy your new wallpaper!" },
];

const CHAR_DELAY = 30;
const FAST_DELAY = 8;

const textEl = document.getElementById("textContent")!;
const nameEl = document.getElementById("namePlate")!;
const indicatorEl = document.getElementById("continueIndicator")!;
const chatboxEl = document.getElementById("chatbox")!;

let currentLine = 0;
let isTyping = false;
let skipTyping = false;
let fullText = "";
let charIndex = 0;

function showLine(line: DialogueLine) {
  nameEl.textContent = line.name;
  fullText = line.text;
  charIndex = 0;
  isTyping = true;
  skipTyping = false;
  indicatorEl.classList.remove("visible");
  textEl.innerHTML = '<span class="cursor"></span>';
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
    // Click while typing → skip to end of line
    skipTyping = true;
    return;
  }

  currentLine++;

  if (currentLine >= script.length) {
    // All lines done → dismiss
    window.chatboxAPI?.dismiss();
    return;
  }

  showLine(script[currentLine]);
}

// Click anywhere on chatbox to advance
chatboxEl.addEventListener("click", advance);

// Spacebar or Enter also advance
window.addEventListener("keydown", (e) => {
  if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    advance();
  }
});

// Start first line
showLine(script[0]);
