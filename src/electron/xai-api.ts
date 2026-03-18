// xAI Grok Imagine API — image & video generation
import * as fs from "fs";
import * as path from "path";
import { net } from "electron";

const API_BASE = "https://api.x.ai/v1";

export interface ImageGenOptions {
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  model?: string;
}

export interface VideoGenOptions {
  prompt: string;
  duration?: number;
  aspectRatio?: string;
  resolution?: string;
}

export interface GenerationResult {
  success: boolean;
  filePath?: string;
  error?: string;
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
export async function generateImage(opts: ImageGenOptions, outputDir: string): Promise<GenerationResult> {
  const apiKey = getApiKey();
  if (!apiKey) return { success: false, error: "No xAI API key configured" };

  const body = {
    model: opts.model || "grok-imagine-image",
    prompt: opts.prompt,
    n: 1,
    aspect_ratio: opts.aspectRatio || "16:9",
    resolution: opts.resolution || "1k",
    response_format: "url",
  };

  console.log("[xai] Generating image:", opts.prompt);

  const res = await apiFetch(`${API_BASE}/images/generations`, {
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

  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `generated_${Date.now()}.png`);
  await downloadFile(imageUrl, filePath);

  console.log("[xai] Image saved:", filePath);
  return { success: true, filePath };
}

// ── Video Generation (async polling) ─────────────────────────
export async function generateVideo(opts: VideoGenOptions, outputDir: string): Promise<GenerationResult> {
  const apiKey = getApiKey();
  if (!apiKey) return { success: false, error: "No xAI API key configured" };

  const body = {
    model: "grok-imagine-video",
    prompt: opts.prompt,
    duration: opts.duration || 5,
    aspect_ratio: opts.aspectRatio || "16:9",
    resolution: opts.resolution || "720p",
  };

  console.log("[xai] Generating video:", opts.prompt);

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
    return { success: false, error: `API error ${submitRes.status}: ${JSON.stringify(err)}` };
  }

  const { request_id } = await submitRes.json();
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
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
      const filePath = path.join(outputDir, `generated_${Date.now()}.mp4`);
      await downloadFile(result.video.url, filePath);
      console.log("[xai] Video saved:", filePath);
      return { success: true, filePath };
    }

    if (result.status === "failed" || result.status === "expired") {
      return { success: false, error: `Video generation ${result.status}` };
    }
  }

  return { success: false, error: "Video generation timed out (10 min)" };
}
