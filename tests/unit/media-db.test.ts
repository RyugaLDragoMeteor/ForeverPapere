import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// Set APPDATA to a temp dir BEFORE importing media-db
const tmpDir = path.join(os.tmpdir(), `foreverpapere-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
process.env.APPDATA = tmpDir;

// Import once — we'll reset the store between tests by manipulating the JSON file
import * as db from "../../src/electron/media-db";

function resetStore() {
  // Write an empty store to disk, then force reload by closing and re-importing
  const dbPath = path.join(tmpDir, "ForeverPapere", "media.json");
  fs.writeFileSync(dbPath, JSON.stringify({
    nextId: 1, nextCharacterId: 1, records: [], characters: []
  }));
  // Force internal store to reload by calling closeDb then accessing data
  db.closeDb();
  // The internal `store` variable is cached. We need to nullify it.
  // Since we can't access it directly, we'll use a workaround:
  // delete the JSON, close, then the next load() call will create a fresh store.
  fs.writeFileSync(dbPath, JSON.stringify({
    nextId: 1, nextCharacterId: 1, records: [], characters: []
  }));
}

beforeEach(() => {
  // Ensure dirs exist
  const appDir = path.join(tmpDir, "ForeverPapere");
  const mediaDir = path.join(appDir, "media");
  for (const d of [appDir, mediaDir, path.join(mediaDir, "images"), path.join(mediaDir, "videos")]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
});

afterEach(() => {
  try { db.closeDb(); } catch (_) {}
});

describe("media-db", () => {
  describe("addMedia / getMediaById", () => {
    it("adds a record and retrieves it by ID", () => {
      const record = db.addMedia({
        filename: "test.png",
        filepath: "/tmp/test.png",
        type: "image",
        source: "uploaded",
        tags: ["test"],
      });
      expect(record.id).toBeGreaterThan(0);
      expect(record.type).toBe("image");
      expect(record.source).toBe("uploaded");
      expect(record.tags).toEqual(["test"]);

      const found = db.getMediaById(record.id);
      expect(found).not.toBeNull();
      expect(found!.filename).toBe("test.png");
    });

    it("auto-increments IDs", () => {
      const r1 = db.addMedia({ filename: "a.png", filepath: "/a", type: "image", source: "uploaded" });
      const r2 = db.addMedia({ filename: "b.mp4", filepath: "/b", type: "video", source: "generated" });
      expect(r2.id).toBe(r1.id + 1);
    });

    it("returns null for nonexistent ID", () => {
      expect(db.getMediaById(99999)).toBeNull();
    });
  });

  describe("getAllMedia", () => {
    it("filters by type", () => {
      db.addMedia({ filename: "a.png", filepath: "/a", type: "image", source: "uploaded" });
      db.addMedia({ filename: "b.mp4", filepath: "/b", type: "video", source: "generated" });
      db.addMedia({ filename: "c.png", filepath: "/c", type: "image", source: "generated" });

      const images = db.getAllMedia("image");
      const videos = db.getAllMedia("video");
      expect(images.length).toBeGreaterThanOrEqual(2);
      expect(videos.length).toBeGreaterThanOrEqual(1);
    });

    it("filters by source", () => {
      const before = db.getAllMedia("image", "uploaded").length;
      db.addMedia({ filename: "x.png", filepath: "/x", type: "image", source: "uploaded" });
      db.addMedia({ filename: "y.png", filepath: "/y", type: "image", source: "generated" });

      expect(db.getAllMedia("image", "uploaded").length).toBe(before + 1);
      expect(db.getAllMedia("image", "generated").length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("getLatestMedia / getDefaultWallpaper", () => {
    it("returns the newest record of a type", () => {
      db.addMedia({ filename: "old.mp4", filepath: "/old", type: "video", source: "uploaded" });
      db.addMedia({ filename: "newer.mp4", filepath: "/newer", type: "video", source: "generated" });

      const latest = db.getLatestMedia("video");
      expect(latest).not.toBeNull();
      expect(latest!.filename).toBe("newer.mp4");
    });

    it("getDefaultWallpaper prefers video over image", () => {
      db.addMedia({ filename: "pic.png", filepath: "/pic", type: "image", source: "uploaded" });
      db.addMedia({ filename: "vid.mp4", filepath: "/vid", type: "video", source: "uploaded" });

      const def = db.getDefaultWallpaper();
      expect(def).not.toBeNull();
      expect(def!.type).toBe("video");
    });
  });

  describe("searchByTag / updateTags", () => {
    it("finds records by tag", () => {
      db.addMedia({ filename: "tagged.png", filepath: "/t", type: "image", source: "uploaded", tags: ["lofi", "anime"] });

      expect(db.searchByTag("lofi").some(r => r.filename === "tagged.png")).toBe(true);
      expect(db.searchByTag("anime").some(r => r.filename === "tagged.png")).toBe(true);
    });

    it("updates tags on a record", () => {
      const r = db.addMedia({ filename: "ut.png", filepath: "/ut", type: "image", source: "uploaded", tags: ["old"] });
      db.updateTags(r.id, ["new", "updated"]);

      const found = db.getMediaById(r.id);
      expect(found!.tags).toEqual(["new", "updated"]);
    });
  });

  describe("deleteMedia", () => {
    it("removes a record", () => {
      const r = db.addMedia({ filename: "del.png", filepath: "/nonexistent", type: "image", source: "uploaded" });
      expect(db.deleteMedia(r.id)).toBe(true);
      expect(db.getMediaById(r.id)).toBeNull();
    });

    it("returns false for nonexistent ID", () => {
      expect(db.deleteMedia(99999)).toBe(false);
    });
  });

  describe("characters", () => {
    it("adds and retrieves a character", () => {
      const c = db.addCharacter(`Saber_${Date.now()}`);
      expect(c.id).toBeGreaterThan(0);
      expect(db.getCharacterById(c.id)).not.toBeNull();
    });

    it("finds character by name (case insensitive)", () => {
      const name = `Shirou_${Date.now()}`;
      db.addCharacter(name);
      expect(db.getCharacterByName(name.toLowerCase())).not.toBeNull();
      expect(db.getCharacterByName(name.toUpperCase())).not.toBeNull();
    });

    it("ensureCharacter creates if not exists, reuses if exists", () => {
      const name = `Archer_${Date.now()}`;
      const c1 = db.ensureCharacter(name);
      const c2 = db.ensureCharacter(name);
      expect(c1.id).toBe(c2.id);
    });

    it("links media to character", () => {
      const c = db.addCharacter(`Rin_${Date.now()}`);
      const m = db.addMedia({ filename: "rin.png", filepath: "/rin", type: "image", source: "uploaded" });
      db.linkMediaToCharacter(m.id, c.id);

      const linked = db.getMediaByCharacter(c.id);
      expect(linked.some(r => r.id === m.id)).toBe(true);
    });

    it("deleteCharacter unlinks associated media", () => {
      const c = db.addCharacter(`Sakura_${Date.now()}`);
      const m = db.addMedia({ filename: "sak.png", filepath: "/s", type: "image", source: "uploaded" });
      db.linkMediaToCharacter(m.id, c.id);

      db.deleteCharacter(c.id);
      expect(db.getCharacterById(c.id)).toBeNull();

      const updated = db.getMediaById(m.id);
      expect(updated!.character_id).toBeNull();
    });

    it("getCharacterSprite returns tagged media", () => {
      const c = db.addCharacter(`Emiya_${Date.now()}`);
      const m = db.addMedia({
        filename: "sprite.png", filepath: "/sprite", type: "image",
        source: "uploaded", tags: ["character"],
      });
      db.linkMediaToCharacter(m.id, c.id);

      const sprite = db.getCharacterSprite(c.id);
      expect(sprite).not.toBeNull();
      expect(sprite!.id).toBe(m.id);
    });
  });

  describe("generated media metadata", () => {
    it("stores prompt, model, and generation metadata", () => {
      const r = db.addMedia({
        filename: "gen.mp4", filepath: "/gen", type: "video", source: "generated",
        prompt: "lofi study scene", model: "grok-imagine-video",
        tags: ["generated", "ai"], duration: 5,
        aspectRatio: "16:9", resolution: "1080p",
        sourceImageId: 1, characterId: 2,
      });

      const found = db.getMediaById(r.id)!;
      expect(found.prompt).toBe("lofi study scene");
      expect(found.model).toBe("grok-imagine-video");
      expect(found.duration).toBe(5);
      expect(found.aspect_ratio).toBe("16:9");
      expect(found.resolution).toBe("1080p");
      expect(found.source_image_id).toBe(1);
      expect(found.character_id).toBe(2);
    });
  });
});
