// Pure utility functions — no Electron imports, fully testable.

export type ChatboxPosition = "bottom-left" | "bottom-center" | "bottom-right" | "top-left" | "top-right";

export const CHATBOX_WIDTH = 900;
export const CHATBOX_HEIGHT = 520;
export const CHATBOX_MARGIN = 20;

export const SUPPORTED_ASPECTS = ["16:9", "9:16", "1:1", "4:3", "3:4", "16:10", "10:16"] as const;

export function detectAspectRatio(width: number, height: number): string {
  const ratio = width / height;
  const aspects: { label: string; value: number }[] = [
    { label: "16:9", value: 16 / 9 },
    { label: "9:16", value: 9 / 16 },
    { label: "1:1", value: 1 },
    { label: "4:3", value: 4 / 3 },
    { label: "3:4", value: 3 / 4 },
    { label: "16:10", value: 16 / 10 },
    { label: "10:16", value: 10 / 16 },
  ];
  let best = aspects[0];
  let bestDiff = Math.abs(ratio - best.value);
  for (const a of aspects) {
    const diff = Math.abs(ratio - a.value);
    if (diff < bestDiff) { best = a; bestDiff = diff; }
  }
  return best.label;
}

export function computeChatboxBounds(
  screenW: number, screenH: number, position: ChatboxPosition,
): { x: number; y: number; width: number; height: number } {
  let x: number, y: number;

  if (position.includes("left")) {
    x = CHATBOX_MARGIN;
  } else if (position.includes("right")) {
    x = screenW - CHATBOX_WIDTH - CHATBOX_MARGIN;
  } else {
    x = Math.round((screenW - CHATBOX_WIDTH) / 2);
  }

  if (position.startsWith("top")) {
    y = CHATBOX_MARGIN;
  } else {
    y = screenH - CHATBOX_HEIGHT - CHATBOX_MARGIN;
  }

  return { x, y, width: CHATBOX_WIDTH, height: CHATBOX_HEIGHT };
}

export function createTrayIconBuffer(): Buffer {
  const size = 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const x = i % size;
    const y = Math.floor(i / size);
    const corner = (x < 2 && y < 2) || (x > 13 && y < 2) ||
                   (x < 2 && y > 13) || (x > 13 && y > 13);
    if (corner) {
      buf.writeUInt32BE(0x00000000, i * 4);
    } else {
      const r = 99 + Math.round((x / size) * 40);
      const g = 102 - Math.round((y / size) * 30);
      const b = 241;
      buf[i * 4] = r;
      buf[i * 4 + 1] = g;
      buf[i * 4 + 2] = b;
      buf[i * 4 + 3] = 255;
    }
  }
  return buf;
}

export function getSpriteAlign(position: ChatboxPosition): "left" | "center" | "right" {
  if (position.includes("left")) return "left";
  if (position.includes("right")) return "right";
  return "center";
}
