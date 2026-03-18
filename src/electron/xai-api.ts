// xAI Grok Imagine API — image & video generation
import * as fs from "fs";
import * as path from "path";
import { net } from "electron";
import { IMAGES_DIR, VIDEOS_DIR, registerGenerated } from "./media-db";

const API_BASE = "https://api.x.ai/v1";

export interface ImageGenOptions {
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  model?: string;
  sourceImagePath?: string;
  sourceImageId?: number;  // DB id of the source image
  characterId?: number;    // DB id of the character
}

export interface VideoGenOptions {
  prompt: string;
  duration?: number;
  aspectRatio?: string;
  resolution?: string;
  sourceImagePath?: string;
  sourceImageId?: number;
  characterId?: number;
}

// Convert a local image file to a base64 data URI
function imageToDataUri(filePath: string): string {
  const data = fs.readFileSync(filePath);
  // Detect actual format from magic bytes, not file extension
  let mime = "image/png";
  if (data[0] === 0xFF && data[1] === 0xD8) {
    mime = "image/jpeg";
  } else if (data[0] === 0x89 && data[1] === 0x50) {
    mime = "image/png";
  } else if (data[0] === 0x52 && data[1] === 0x49) {
    mime = "image/webp";
  }
  console.log(`[xai] Image data URI: ${mime}, ${data.length} bytes`);
  return `data:${mime};base64,${data.toString("base64")}`;
}

export interface GenerationResult {
  success: boolean;
  filePath?: string;
  error?: string;
  dbId?: number;
}

function getApiKey(): string {
  const configPath = path.join(
    process.env.APPDATA || process.env.HOME || ".",
    "ForeverPapere",
    "config.json"
  );
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return config.xaiApiKey || "";
  } catch {
    return "";
  }
}

export function saveApiKey(key: string): void {
  const configDir = path.join(
    process.env.APPDATA || process.env.HOME || ".",
    "ForeverPapere"
  );
  if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
  const configPath = path.join(configDir, "config.json");
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  } catch { /* new config */ }
  config.xaiApiKey = key;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function hasApiKey(): boolean {
  return getApiKey().length > 0;
}

// Helper: fetch with electron's net module (bypasses CORS)
function apiFetch(url: string, options: { method: string; headers: Record<string, string>; body?: string }): Promise<{ ok: boolean; status: number; json: () => Promise<any>; buffer: () => Promise<Buffer> }> {
  return new Promise((resolve, reject) => {
    const request = net.request({
      url,
      method: options.method,
    });
    for (const [k, v] of Object.entries(options.headers)) {
      request.setHeader(k, v);
    }
    let responseData = Buffer.alloc(0);
    request.on("response", (response) => {
      response.on("data", (chunk: Buffer) => {
        responseData = Buffer.concat([responseData, chunk]);
      });
      response.on("end", () => {
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          json: () => Promise.resolve(JSON.parse(responseData.toString("utf-8"))),
          buffer: () => Promise.resolve(responseData),
        });
      });
    });
    request.on("error", reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

// Download a URL to a local file
async function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = net.request(url);
    const chunks: Buffer[] = [];
    request.on("response", (response) => {
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        fs.writeFileSync(destPath, Buffer.concat(chunks));
        resolve();
      });
    });
    request.on("error", reject);
    request.end();
  });
}

// ── Image Generation (synchronous response) ──────────────────
export async function generateImage(opts: ImageGenOptions): Promise<GenerationResult> {
  const apiKey = getApiKey();
  if (!apiKey) return { success: false, error: "No xAI API key configured" };

  let endpoint = `${API_BASE}/images/generations`;
  let body: Record<string, unknown>;

  if (opts.sourceImagePath) {
    // Image editing: use the edits endpoint with source image
    endpoint = `${API_BASE}/images/edits`;
    const dataUri = imageToDataUri(opts.sourceImagePath);
    body = {
      model: opts.model || "grok-imagine-image",
      prompt: opts.prompt,
      image: {
        url: dataUri,
        type: "image_url",
      },
    };
    console.log("[xai] Editing image with source:", opts.sourceImagePath);
  } else {
    body = {
      model: opts.model || "grok-imagine-image",
      prompt: opts.prompt,
      n: 1,
      aspect_ratio: opts.aspectRatio || "16:9",
      resolution: opts.resolution || "1k",
      response_format: "url",
    };
    console.log("[xai] Generating image:", opts.prompt);
  }

  const res = await apiFetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json();
    return { success: false, error: `API error ${res.status}: ${JSON.stringify(err)}` };
  }

  const data = await res.json();
  const imageUrl = data.data?.[0]?.url;
  if (!imageUrl) return { success: false, error: "No image URL in response" };

  const filePath = path.join(IMAGES_DIR, `generated_${Date.now()}.png`);
  await downloadFile(imageUrl, filePath);

  const record = registerGenerated({
    filepath: filePath,
    type: "image",
    prompt: opts.prompt,
    model: opts.model || "grok-imagine-image",
    tags: ["generated", "ai", opts.sourceImagePath ? "edited" : "text-to-image"],
    aspectRatio: opts.aspectRatio,
    sourceImageId: opts.sourceImageId,
    characterId: opts.characterId,
  });

  console.log("[xai] Image saved:", filePath, "db id:", record.id);
  return { success: true, filePath, dbId: record.id };
}

// ── Video Generation (async polling) ─────────────────────────
export async function generateVideo(opts: VideoGenOptions): Promise<GenerationResult> {
  const apiKey = getApiKey();
  if (!apiKey) return { success: false, error: "No xAI API key configured" };

  let body: Record<string, unknown>;

  if (opts.sourceImagePath) {
    // Image-to-video: use nested image object (matching xAI SDK gRPC format)
    body = {
      model: "grok-imagine-video",
      prompt: opts.prompt,
      image: {
        url: imageToDataUri(opts.sourceImagePath),
        type: "image_url",
      },
      duration: opts.duration || 5,
    };
    console.log("[xai] Image-to-video with source:", opts.sourceImagePath);
  } else {
    body = {
      model: "grok-imagine-video",
      prompt: opts.prompt,
      duration: opts.duration || 5,
      aspect_ratio: opts.aspectRatio || "16:9",
      resolution: opts.resolution || "720p",
    };
  }

  console.log("[xai] Generating video:", opts.prompt);

  // Log the body keys (not values - they may be huge base64)
  console.log("[xai] Video request body keys:", Object.keys(body), "has source:", !!opts.sourceImagePath);

  const submitRes = await apiFetch(`${API_BASE}/videos/generations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!submitRes.ok) {
    const err = await submitRes.json();
    console.error("[xai] Video submit error:", JSON.stringify(err));
    return { success: false, error: `API error ${submitRes.status}: ${JSON.stringify(err)}` };
  }

  const submitData = await submitRes.json();
  console.log("[xai] Video submit response:", JSON.stringify(submitData));
  const { request_id } = submitData;
  if (!request_id) return { success: false, error: "No request_id in response" };

  console.log("[xai] Video request submitted:", request_id);

  // Poll for completion (up to 10 minutes)
  const maxWait = 10 * 60 * 1000;
  const pollInterval = 5000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    await new Promise((r) => setTimeout(r, pollInterval));

    const pollRes = await apiFetch(`${API_BASE}/videos/${request_id}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!pollRes.ok) continue;

    const result = await pollRes.json();
    console.log("[xai] Video status:", result.status);

    if (result.status === "done" && result.video?.url) {
      const filePath = path.join(VIDEOS_DIR, `generated_${Date.now()}.mp4`);
      await downloadFile(result.video.url, filePath);

      const record = registerGenerated({
        filepath: filePath,
        type: "video",
        prompt: opts.prompt,
        model: "grok-imagine-video",
        tags: ["generated", "ai", opts.sourceImagePath ? "image-to-video" : "text-to-video"],
        duration: opts.duration,
        aspectRatio: opts.aspectRatio,
        resolution: opts.resolution,
        sourceImageId: opts.sourceImageId,
        characterId: opts.characterId,
      });

      console.log("[xai] Video saved:", filePath, "db id:", record.id);
      return { success: true, filePath, dbId: record.id };
    }

    if (result.status === "failed" || result.status === "expired") {
      return { success: false, error: `Video generation ${result.status}` };
    }
  }

  return { success: false, error: "Video generation timed out (10 min)" };
}

// ── Two-step pipeline: image-edit → image-to-video ───────────
// First creates a scene with the character via image editing,
// then animates that scene into a looping video.
export async function generateCharacterVideo(
  opts: VideoGenOptions & { sourceImagePath: string },
  onStatus?: (msg: string) => void,
): Promise<GenerationResult> {
  onStatus?.("Step 1/2: Creating scene with your character...");

  // Step 1: Generate the scene image with the character
  const imgResult = await generateImage({
    prompt: opts.prompt,
    sourceImagePath: opts.sourceImagePath,
    sourceImageId: opts.sourceImageId,
    characterId: opts.characterId,
    aspectRatio: opts.aspectRatio || "16:9",
  });

  if (!imgResult.success || !imgResult.filePath) {
    return { success: false, error: `Image step failed: ${imgResult.error}` };
  }

  console.log("[xai] Scene image created:", imgResult.filePath);
  onStatus?.("Step 2/2: Animating scene into video... this may take a few minutes.");

  // Step 2: Animate the scene image into a video
  const videoResult = await generateVideo({
    prompt: "Animate this image with subtle gentle motion. Hair sways slightly, light flickers softly, steam rises from cup, pages flutter gently. Lofi calm peaceful atmosphere.",
    duration: opts.duration || 5,
    aspectRatio: opts.aspectRatio || "16:9",
    resolution: opts.resolution || "720p",
    sourceImagePath: imgResult.filePath,
    sourceImageId: imgResult.dbId,
    characterId: opts.characterId,
  });

  return videoResult;
}
