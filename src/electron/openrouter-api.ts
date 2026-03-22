// OpenRouter API — image generation via chat/completions with modalities
import * as fs from "fs";
import * as path from "path";
import { net } from "electron";
import { IMAGES_DIR, VIDEOS_DIR, registerGenerated } from "./media-db";
import { getApiKey } from "./openrouter-auth";

const API_BASE = "https://openrouter.ai/api/v1";

// Default models
const IMAGE_MODEL = "google/gemini-2.5-flash-preview-image-generation";
const IMAGE_EDIT_MODEL = "google/gemini-2.5-flash-preview-image-generation";

export interface ImageGenOptions {
  prompt: string;
  aspectRatio?: string;
  imageSize?: string;
  model?: string;
  sourceImagePath?: string;
  sourceImageId?: number;
  characterId?: number;
}

export interface GenerationResult {
  success: boolean;
  filePath?: string;
  error?: string;
  dbId?: number;
}

// Convert a local image file to a base64 data URI
function imageToDataUri(filePath: string): string {
  const data = fs.readFileSync(filePath);
  let mime = "image/png";
  if (data[0] === 0xFF && data[1] === 0xD8) mime = "image/jpeg";
  else if (data[0] === 0x89 && data[1] === 0x50) mime = "image/png";
  else if (data[0] === 0x52 && data[1] === 0x49) mime = "image/webp";
  return `data:${mime};base64,${data.toString("base64")}`;
}

// Helper: fetch with electron's net module (bypasses CORS)
function apiFetch(url: string, options: {
  method: string;
  headers: Record<string, string>;
  body?: string;
}): Promise<{ ok: boolean; status: number; json: () => Promise<any>; buffer: () => Promise<Buffer> }> {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, method: options.method });
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

// Extract base64 image from OpenRouter response
function extractImageFromResponse(data: any): string | null {
  const content = data?.choices?.[0]?.message?.content;
  if (!content) return null;

  // Content can be a string or array of parts
  if (typeof content === "string") {
    // Check for markdown image with base64
    const match = content.match(/!\[.*?\]\((data:image\/[^)]+)\)/);
    if (match) return match[1];
    // Check for raw base64 data URI
    if (content.startsWith("data:image/")) return content;
    return null;
  }

  if (Array.isArray(content)) {
    for (const part of content) {
      if (part.type === "image_url" && part.image_url?.url) {
        return part.image_url.url;
      }
      if (part.type === "image" && part.source?.data) {
        const mime = part.source.media_type || "image/png";
        return `data:${mime};base64,${part.source.data}`;
      }
      // Inline base64 block
      if (part.type === "inline_data" && part.data) {
        const mime = part.mime_type || "image/png";
        return `data:${mime};base64,${part.data}`;
      }
    }
  }

  return null;
}

// Save a data URI or URL to a file
async function saveImage(imageData: string, destPath: string): Promise<void> {
  if (imageData.startsWith("data:")) {
    // Base64 data URI
    const base64 = imageData.split(",")[1];
    fs.writeFileSync(destPath, Buffer.from(base64, "base64"));
  } else if (imageData.startsWith("http")) {
    await downloadFile(imageData, destPath);
  } else {
    // Raw base64 without prefix
    fs.writeFileSync(destPath, Buffer.from(imageData, "base64"));
  }
}

// ── Image Generation ──────────────────────────────────────
export async function generateImage(opts: ImageGenOptions): Promise<GenerationResult> {
  const apiKey = getApiKey();
  if (!apiKey) return { success: false, error: "Not authenticated. Please sign in with OpenRouter." };

  const model = opts.model || (opts.sourceImagePath ? IMAGE_EDIT_MODEL : IMAGE_MODEL);

  // Build messages
  const messages: any[] = [];

  if (opts.sourceImagePath) {
    // Image-to-image: include source image in message
    const dataUri = imageToDataUri(opts.sourceImagePath);
    console.log("[openrouter] Image edit with source:", opts.sourceImagePath);
    messages.push({
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: { url: dataUri },
        },
        {
          type: "text",
          text: opts.prompt,
        },
      ],
    });
  } else {
    console.log("[openrouter] Generating image:", opts.prompt);
    messages.push({
      role: "user",
      content: opts.prompt,
    });
  }

  const body: Record<string, unknown> = {
    model,
    messages,
    modalities: ["image", "text"],
  };

  // Add image config if aspect ratio specified
  if (opts.aspectRatio || opts.imageSize) {
    body.image_config = {
      ...(opts.aspectRatio && { aspect_ratio: opts.aspectRatio }),
      ...(opts.imageSize && { image_size: opts.imageSize }),
    };
  }

  const res = await apiFetch(`${API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    return { success: false, error: `API error ${res.status}: ${JSON.stringify(err)}` };
  }

  const data = await res.json();
  const imageData = extractImageFromResponse(data);

  if (!imageData) {
    console.error("[openrouter] No image in response:", JSON.stringify(data).slice(0, 500));
    return { success: false, error: "No image in API response" };
  }

  // Determine file extension from data
  let ext = ".png";
  if (imageData.includes("image/jpeg")) ext = ".jpg";
  else if (imageData.includes("image/webp")) ext = ".webp";

  const filePath = path.join(IMAGES_DIR, `generated_${Date.now()}${ext}`);
  await saveImage(imageData, filePath);

  const record = registerGenerated({
    filepath: filePath,
    type: "image",
    prompt: opts.prompt,
    model,
    tags: ["generated", "ai", opts.sourceImagePath ? "edited" : "text-to-image"],
    aspectRatio: opts.aspectRatio,
    sourceImageId: opts.sourceImageId,
    characterId: opts.characterId,
  });

  console.log("[openrouter] Image saved:", filePath, "db id:", record.id);
  return { success: true, filePath, dbId: record.id };
}

// ── Character wallpaper generation (image-edit based) ─────
// Creates a scene with the character via image editing.
// Returns a static image (OpenRouter doesn't have native video gen yet).
export async function generateCharacterWallpaper(
  opts: ImageGenOptions & { sourceImagePath: string },
  onStatus?: (msg: string) => void,
): Promise<GenerationResult> {
  onStatus?.("Generating wallpaper with your character...");

  const result = await generateImage({
    prompt: opts.prompt,
    sourceImagePath: opts.sourceImagePath,
    sourceImageId: opts.sourceImageId,
    characterId: opts.characterId,
    aspectRatio: opts.aspectRatio || "16:9",
    imageSize: opts.imageSize || "2K",
    model: opts.model,
  });

  return result;
}
