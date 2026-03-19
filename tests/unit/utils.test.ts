import { describe, it, expect } from "vitest";
import {
  detectAspectRatio,
  computeChatboxBounds,
  createTrayIconBuffer,
  getSpriteAlign,
  CHATBOX_WIDTH,
  CHATBOX_HEIGHT,
  CHATBOX_MARGIN,
} from "../../src/electron/utils";

describe("detectAspectRatio", () => {
  it("detects 16:9 (1920x1080)", () => {
    expect(detectAspectRatio(1920, 1080)).toBe("16:9");
  });

  it("detects 16:9 (2560x1440)", () => {
    expect(detectAspectRatio(2560, 1440)).toBe("16:9");
  });

  it("detects 16:9 (3840x2160 / 4K)", () => {
    expect(detectAspectRatio(3840, 2160)).toBe("16:9");
  });

  it("detects 16:10 (2560x1600)", () => {
    expect(detectAspectRatio(2560, 1600)).toBe("16:10");
  });

  it("detects 16:10 (1920x1200)", () => {
    expect(detectAspectRatio(1920, 1200)).toBe("16:10");
  });

  it("detects 9:16 (portrait, 1080x1920)", () => {
    expect(detectAspectRatio(1080, 1920)).toBe("9:16");
  });

  it("detects 1:1 (1080x1080)", () => {
    expect(detectAspectRatio(1080, 1080)).toBe("1:1");
  });

  it("detects 4:3 (1024x768)", () => {
    expect(detectAspectRatio(1024, 768)).toBe("4:3");
  });

  it("detects 3:4 (768x1024)", () => {
    expect(detectAspectRatio(768, 1024)).toBe("3:4");
  });

  it("snaps 1366x768 to nearest (16:9)", () => {
    expect(detectAspectRatio(1366, 768)).toBe("16:9");
  });

  it("snaps ultrawide 3440x1440 to nearest", () => {
    // 3440/1440 = 2.39, which is far from all options.
    // Closest is 16:9 (1.78) vs 16:10 (1.6). 16:9 wins.
    const result = detectAspectRatio(3440, 1440);
    expect(["16:9", "16:10"]).toContain(result);
  });
});

describe("computeChatboxBounds", () => {
  const screenW = 1920;
  const screenH = 1080;

  it("bottom-center: centered horizontally, bottom vertically", () => {
    const b = computeChatboxBounds(screenW, screenH, "bottom-center");
    expect(b.x).toBe(Math.round((screenW - CHATBOX_WIDTH) / 2));
    expect(b.y).toBe(screenH - CHATBOX_HEIGHT - CHATBOX_MARGIN);
    expect(b.width).toBe(CHATBOX_WIDTH);
    expect(b.height).toBe(CHATBOX_HEIGHT);
  });

  it("bottom-left: left edge, bottom", () => {
    const b = computeChatboxBounds(screenW, screenH, "bottom-left");
    expect(b.x).toBe(CHATBOX_MARGIN);
    expect(b.y).toBe(screenH - CHATBOX_HEIGHT - CHATBOX_MARGIN);
  });

  it("bottom-right: right edge, bottom", () => {
    const b = computeChatboxBounds(screenW, screenH, "bottom-right");
    expect(b.x).toBe(screenW - CHATBOX_WIDTH - CHATBOX_MARGIN);
    expect(b.y).toBe(screenH - CHATBOX_HEIGHT - CHATBOX_MARGIN);
  });

  it("top-left: left edge, top", () => {
    const b = computeChatboxBounds(screenW, screenH, "top-left");
    expect(b.x).toBe(CHATBOX_MARGIN);
    expect(b.y).toBe(CHATBOX_MARGIN);
  });

  it("top-right: right edge, top", () => {
    const b = computeChatboxBounds(screenW, screenH, "top-right");
    expect(b.x).toBe(screenW - CHATBOX_WIDTH - CHATBOX_MARGIN);
    expect(b.y).toBe(CHATBOX_MARGIN);
  });

  it("works with different screen sizes", () => {
    const b = computeChatboxBounds(2560, 1600, "bottom-center");
    expect(b.x).toBe(Math.round((2560 - CHATBOX_WIDTH) / 2));
    expect(b.y).toBe(1600 - CHATBOX_HEIGHT - CHATBOX_MARGIN);
  });
});

describe("createTrayIconBuffer", () => {
  it("returns a buffer of correct size (16x16 RGBA)", () => {
    const buf = createTrayIconBuffer();
    expect(buf.length).toBe(16 * 16 * 4);
  });

  it("corner pixels are transparent", () => {
    const buf = createTrayIconBuffer();
    // Top-left corner (0,0)
    expect(buf[3]).toBe(0); // alpha = 0
    // Top-right corner (15,0)
    expect(buf[(15) * 4 + 3]).toBe(0);
    // Bottom-left corner (0,15)
    expect(buf[(15 * 16) * 4 + 3]).toBe(0);
    // Bottom-right corner (15,15)
    expect(buf[(15 * 16 + 15) * 4 + 3]).toBe(0);
  });

  it("non-corner pixels are opaque with blue=241", () => {
    const buf = createTrayIconBuffer();
    // Center pixel (8,8)
    const idx = (8 * 16 + 8) * 4;
    expect(buf[idx + 2]).toBe(241); // blue channel
    expect(buf[idx + 3]).toBe(255); // alpha = opaque
  });
});

describe("getSpriteAlign", () => {
  it("returns left for left positions", () => {
    expect(getSpriteAlign("bottom-left")).toBe("left");
    expect(getSpriteAlign("top-left")).toBe("left");
  });

  it("returns right for right positions", () => {
    expect(getSpriteAlign("bottom-right")).toBe("right");
    expect(getSpriteAlign("top-right")).toBe("right");
  });

  it("returns center for center positions", () => {
    expect(getSpriteAlign("bottom-center")).toBe("center");
  });
});
