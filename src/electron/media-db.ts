// ForeverPapere — Media database (JSON-backed) for tracking images and videos
import * as path from "path";
import * as fs from "fs";

// ── App data directory (re-evaluated via getters so tests can override APPDATA) ──
function getAppDir() { return path.join(process.env.APPDATA || process.env.HOME || ".", "ForeverPapere"); }
function getMediaDir() { return path.join(getAppDir(), "media"); }
function getImagesDir() { return path.join(getMediaDir(), "images"); }
function getVideosDir() { return path.join(getMediaDir(), "videos"); }
function getDbPath() { return path.join(getAppDir(), "media.json"); }

// Lazy-init: ensure directories exist on first access
let dirsEnsured = false;
function ensureDirs() {
  if (dirsEnsured) return;
  for (const dir of [getAppDir(), getMediaDir(), getImagesDir(), getVideosDir()]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  dirsEnsured = true;
}

// Public aliases (evaluate at call time)
export const APP_DIR = getAppDir();
export const MEDIA_DIR = getMediaDir();
export const IMAGES_DIR = getImagesDir();
export const VIDEOS_DIR = getVideosDir();

ensureDirs();

// ── Types ───────────────────────────────────────────────────
export type MediaType = "image" | "video";
export type MediaSource = "generated" | "uploaded";

export interface Character {
  id: number;
  name: string;
  created_at: string;
}

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
  source_image_id: number | null;  // media ID of the image used to generate this
  character_id: number | null;     // character this media is associated with
}

interface MediaStore {
  nextId: number;
  nextCharacterId: number;
  records: MediaRecord[];
  characters: Character[];
}

// ── JSON Store ──────────────────────────────────────────────
let store: MediaStore | null = null;

function load(): MediaStore {
  if (store) return store;
  ensureDirs();
  try {
    const raw = JSON.parse(fs.readFileSync(getDbPath(), "utf-8"));
    // Migrate old schema if needed
    if (!raw.characters) raw.characters = [];
    if (!raw.nextCharacterId) raw.nextCharacterId = 1;
    for (const r of raw.records) {
      if (r.character_id === undefined) r.character_id = null;
    }
    // Remove deprecated image_id from characters
    for (const c of raw.characters) {
      delete (c as any).image_id;
    }
    store = raw;
  } catch {
    store = { nextId: 1, nextCharacterId: 1, records: [], characters: [] };
  }
  console.log("[media-db] Loaded", store!.records.length, "media,", store!.characters.length, "characters from", getDbPath());
  return store!;
}

function save(): void {
  if (!store) return;
  fs.writeFileSync(getDbPath(), JSON.stringify(store, null, 2));
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
  characterId?: number;
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
    character_id: opts.characterId || null,
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

// ── Character operations ─────────────────────────────────────

export function addCharacter(name: string): Character {
  const s = load();
  const character: Character = {
    id: s.nextCharacterId++,
    name,
    created_at: new Date().toISOString(),
  };
  s.characters.push(character);
  save();
  console.log(`[media-db] Added character: ${name} (id=${character.id})`);
  return character;
}

export function getCharacterById(id: number): Character | null {
  return load().characters.find((c) => c.id === id) || null;
}

export function getCharacterByName(name: string): Character | null {
  return load().characters.find((c) => c.name.toLowerCase() === name.toLowerCase()) || null;
}

export function getAllCharacters(): Character[] {
  return load().characters.sort((a, b) => a.name.localeCompare(b.name));
}

export function getMediaByCharacter(characterId: number): MediaRecord[] {
  return load().records
    .filter((r) => r.character_id === characterId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function updateCharacter(id: number, updates: { name?: string }): void {
  const s = load();
  const character = s.characters.find((c) => c.id === id);
  if (character) {
    if (updates.name !== undefined) character.name = updates.name;
    save();
  }
}

export function deleteCharacter(id: number): boolean {
  const s = load();
  const idx = s.characters.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  // Unlink media from this character
  for (const r of s.records) {
    if (r.character_id === id) r.character_id = null;
  }
  s.characters.splice(idx, 1);
  save();
  return true;
}

export function linkMediaToCharacter(mediaId: number, characterId: number): void {
  const s = load();
  const record = s.records.find((r) => r.id === mediaId);
  if (record) {
    record.character_id = characterId;
    save();
  }
}

/** Get or create a character by name. */
export function ensureCharacter(name: string): Character {
  return getCharacterByName(name) || addCharacter(name);
}

/** Get the sprite image for a character (media tagged "character" linked to them). */
export function getCharacterSprite(characterId: number): MediaRecord | null {
  return load().records.find(
    (r) => r.character_id === characterId && r.tags.includes("character")
  ) || null;
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
  characterId?: number;
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
    characterId: opts.characterId,
  });
}

/** Find the first video or image to use as wallpaper. */
export function getDefaultWallpaper(): MediaRecord | null {
  return getLatestMedia("video") || getLatestMedia("image") || null;
}

export function closeDb(): void {
  if (store) save();
  store = null;
  dirsEnsured = false;
  console.log("[media-db] Store saved");
}
