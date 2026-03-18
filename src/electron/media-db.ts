// ForeverPapere — Media database (JSON-backed) for tracking images and videos
import * as path from "path";
import * as fs from "fs";

// ── App data directory ──────────────────────────────────────
const APP_DIR = path.join(
  process.env.APPDATA || process.env.HOME || ".",
  "ForeverPapere"
);
const MEDIA_DIR = path.join(APP_DIR, "media");
const IMAGES_DIR = path.join(MEDIA_DIR, "images");
const VIDEOS_DIR = path.join(MEDIA_DIR, "videos");
const DB_PATH = path.join(APP_DIR, "media.json");

// Ensure directories exist
for (const dir of [APP_DIR, MEDIA_DIR, IMAGES_DIR, VIDEOS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export { APP_DIR, MEDIA_DIR, IMAGES_DIR, VIDEOS_DIR };

// ── Types ───────────────────────────────────────────────────
export type MediaType = "image" | "video";
export type MediaSource = "generated" | "uploaded";

export interface MediaRecord {
  id: number;
  filename: string;
  filepath: string;
  type: MediaType;
  source: MediaSource;
  prompt: string | null;
  model: string | null;
  tags: string[];
  created_at: string;
  duration: number | null;
  aspect_ratio: string | null;
  resolution: string | null;
  source_image_id: number | null;
}

interface MediaStore {
  nextId: number;
  records: MediaRecord[];
}

// ── JSON Store ──────────────────────────────────────────────
let store: MediaStore | null = null;

function load(): MediaStore {
  if (store) return store;
  try {
    store = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
  } catch {
    store = { nextId: 1, records: [] };
  }
  console.log("[media-db] Loaded", store!.records.length, "records from", DB_PATH);
  return store!;
}

function save(): void {
  if (!store) return;
  fs.writeFileSync(DB_PATH, JSON.stringify(store, null, 2));
}

// ── CRUD operations ─────────────────────────────────────────

export function addMedia(opts: {
  filename: string;
  filepath: string;
  type: MediaType;
  source: MediaSource;
  prompt?: string;
  model?: string;
  tags?: string[];
  duration?: number;
  aspectRatio?: string;
  resolution?: string;
  sourceImageId?: number;
}): MediaRecord {
  const s = load();
  const record: MediaRecord = {
    id: s.nextId++,
    filename: opts.filename,
    filepath: opts.filepath,
    type: opts.type,
    source: opts.source,
    prompt: opts.prompt || null,
    model: opts.model || null,
    tags: opts.tags || [],
    created_at: new Date().toISOString(),
    duration: opts.duration || null,
    aspect_ratio: opts.aspectRatio || null,
    resolution: opts.resolution || null,
    source_image_id: opts.sourceImageId || null,
  };
  s.records.push(record);
  save();
  console.log(`[media-db] Added ${opts.source} ${opts.type}: ${opts.filename} (id=${record.id})`);
  return record;
}

export function getMediaById(id: number): MediaRecord | null {
  return load().records.find((r) => r.id === id) || null;
}

export function getAllMedia(type?: MediaType, source?: MediaSource): MediaRecord[] {
  let records = load().records;
  if (type) records = records.filter((r) => r.type === type);
  if (source) records = records.filter((r) => r.source === source);
  return records.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function getLatestMedia(type: MediaType): MediaRecord | null {
  const records = getAllMedia(type);
  return records.length > 0 ? records[0] : null;
}

export function searchByTag(tag: string): MediaRecord[] {
  return load().records
    .filter((r) => r.tags.includes(tag))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function updateTags(id: number, tags: string[]): void {
  const s = load();
  const record = s.records.find((r) => r.id === id);
  if (record) {
    record.tags = tags;
    save();
  }
}

export function deleteMedia(id: number): boolean {
  const s = load();
  const idx = s.records.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  const record = s.records[idx];

  try {
    if (fs.existsSync(record.filepath)) fs.unlinkSync(record.filepath);
  } catch (e) {
    console.error("[media-db] Failed to delete file:", e);
  }

  s.records.splice(idx, 1);
  save();
  console.log(`[media-db] Deleted media id=${id}: ${record.filename}`);
  return true;
}

// ── Helpers ─────────────────────────────────────────────────

/** Copy an external file into the app's media directory and register it. */
export function importMedia(
  sourcePath: string,
  type: MediaType,
  tags?: string[],
): MediaRecord {
  const ext = path.extname(sourcePath).toLowerCase();
  const destDir = type === "video" ? VIDEOS_DIR : IMAGES_DIR;
  const filename = `uploaded_${Date.now()}${ext}`;
  const destPath = path.join(destDir, filename);

  fs.copyFileSync(sourcePath, destPath);

  return addMedia({
    filename,
    filepath: destPath,
    type,
    source: "uploaded",
    tags: tags || ["uploaded"],
  });
}

/** Save generated media output and register it. */
export function registerGenerated(opts: {
  filepath: string;
  type: MediaType;
  prompt: string;
  model?: string;
  tags?: string[];
  duration?: number;
  aspectRatio?: string;
  resolution?: string;
  sourceImageId?: number;
}): MediaRecord {
  // Move file to app media directory if it's not already there
  const destDir = opts.type === "video" ? VIDEOS_DIR : IMAGES_DIR;
  const filename = path.basename(opts.filepath);
  const destPath = path.join(destDir, filename);

  if (opts.filepath !== destPath) {
    fs.copyFileSync(opts.filepath, destPath);
    try { fs.unlinkSync(opts.filepath); } catch (_) {}
  }

  return addMedia({
    filename,
    filepath: destPath,
    type: opts.type,
    source: "generated",
    prompt: opts.prompt,
    model: opts.model,
    tags: opts.tags || ["generated", "ai"],
    duration: opts.duration,
    aspectRatio: opts.aspectRatio,
    resolution: opts.resolution,
    sourceImageId: opts.sourceImageId,
  });
}

/** Find the first video or image to use as wallpaper. */
export function getDefaultWallpaper(): MediaRecord | null {
  return getLatestMedia("video") || getLatestMedia("image") || null;
}

export function closeDb(): void {
  if (store) save();
  console.log("[media-db] Store saved");
}
