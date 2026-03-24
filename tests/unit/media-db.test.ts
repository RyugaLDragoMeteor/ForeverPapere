import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const testRoot = path.join(os.tmpdir(), `foreverpapere-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
const appDir = path.join(testRoot, "ForeverPapere");
const mediaDir = path.join(appDir, "media");
const imagesDir = path.join(mediaDir, "images");
const videosDir = path.join(mediaDir, "videos");
const dbPath = path.join(appDir, "media.json");

let db: typeof import("../../src/electron/media-db");

// Prod-like seed: 1 character, 1 uploaded sprite, 1 uploaded video,
// several generated image→video pairs linked to the character.
function seedProdLikeDb() {
  // Create fake media files
  const files = [
    { dir: videosDir, name: "uploaded_100.mp4" },
    { dir: imagesDir, name: "uploaded_200.png" },
    { dir: imagesDir, name: "generated_300.png" },
    { dir: videosDir, name: "generated_400.mp4" },
    { dir: imagesDir, name: "generated_500.png" },
    { dir: videosDir, name: "generated_600.mp4" },
  ];
  for (const f of files) {
    fs.writeFileSync(path.join(f.dir, f.name), "fake-data");
  }

  const store = {
    nextId: 7,
    nextCharacterId: 2,
    characters: [
      { id: 1, name: "Miku", created_at: "2026-03-18T17:00:00.000Z" },
    ],
    records: [
      {
        id: 1, filename: "uploaded_100.mp4",
        filepath: path.join(videosDir, "uploaded_100.mp4"),
        type: "video", source: "uploaded",
        prompt: null, model: null,
        tags: ["uploaded", "bundled"],
        created_at: "2026-03-18T17:00:01.000Z",
        duration: null, aspect_ratio: null, resolution: null,
        source_image_id: null, character_id: null,
      },
      {
        id: 2, filename: "uploaded_200.png",
        filepath: path.join(imagesDir, "uploaded_200.png"),
        type: "image", source: "uploaded",
        prompt: null, model: null,
        tags: ["uploaded", "bundled", "character"],
        created_at: "2026-03-18T17:00:02.000Z",
        duration: null, aspect_ratio: null, resolution: null,
        source_image_id: null, character_id: 1,
      },
      {
        id: 3, filename: "generated_300.png",
        filepath: path.join(imagesDir, "generated_300.png"),
        type: "image", source: "generated",
        prompt: "Cozy cafe scene, lo-fi anime style",
        model: "grok-imagine-image",
        tags: ["generated", "ai", "edited"],
        created_at: "2026-03-19T04:44:00.000Z",
        duration: null, aspect_ratio: "16:9", resolution: null,
        source_image_id: 2, character_id: 1,
      },
      {
        id: 4, filename: "generated_400.mp4",
        filepath: path.join(videosDir, "generated_400.mp4"),
        type: "video", source: "generated",
        prompt: "Animate with subtle gentle motion",
        model: "grok-imagine-video",
        tags: ["generated", "ai", "image-to-video"],
        created_at: "2026-03-19T04:45:00.000Z",
        duration: 5, aspect_ratio: "16:9", resolution: "720p",
        source_image_id: 3, character_id: 1,
      },
      {
        id: 5, filename: "generated_500.png",
        filepath: path.join(imagesDir, "generated_500.png"),
        type: "image", source: "generated",
        prompt: "Rooftop garden at golden hour, lo-fi anime",
        model: "grok-imagine-image",
        tags: ["generated", "ai", "edited"],
        created_at: "2026-03-19T04:46:00.000Z",
        duration: null, aspect_ratio: "16:9", resolution: null,
        source_image_id: 2, character_id: 1,
      },
      {
        id: 6, filename: "generated_600.mp4",
        filepath: path.join(videosDir, "generated_600.mp4"),
        type: "video", source: "generated",
        prompt: "Animate with subtle gentle motion",
        model: "grok-imagine-video",
        tags: ["generated", "ai", "image-to-video"],
        created_at: "2026-03-19T04:47:00.000Z",
        duration: 5, aspect_ratio: "16:9", resolution: "720p",
        source_image_id: 5, character_id: 1,
      },
    ],
  };

  fs.writeFileSync(dbPath, JSON.stringify(store, null, 2));
}

beforeAll(async () => {
  process.env.APPDATA = testRoot;
  vi.resetModules();
  db = await import("../../src/electron/media-db");
});

beforeEach(() => {
  for (const d of [appDir, mediaDir, imagesDir, videosDir]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
  seedProdLikeDb();
  db.closeDb(); // reset cache so next access loads the fresh seed
});

afterEach(() => {
  db.closeDb();
});

describe("media-db", () => {
  describe("addMedia / getMediaById", () => {
    it("adds a record and retrieves it by ID", () => {
      const fp = path.join(imagesDir, "new.png");
      fs.writeFileSync(fp, "data");
      const record = db.addMedia({
        filename: "new.png", filepath: fp,
        type: "image", source: "uploaded", tags: ["test"],
      });
      expect(record.id).toBe(7); // nextId after seed
      expect(record.type).toBe("image");
      expect(record.source).toBe("uploaded");
      expect(record.tags).toEqual(["test"]);

      const found = db.getMediaById(record.id);
      expect(found).not.toBeNull();
      expect(found!.filename).toBe("new.png");
    });

    it("auto-increments IDs", () => {
      const fpA = path.join(imagesDir, "a.png");
      const fpB = path.join(videosDir, "b.mp4");
      fs.writeFileSync(fpA, "data");
      fs.writeFileSync(fpB, "data");
      const r1 = db.addMedia({ filename: "a.png", filepath: fpA, type: "image", source: "uploaded" });
      const r2 = db.addMedia({ filename: "b.mp4", filepath: fpB, type: "video", source: "generated" });
      expect(r2.id).toBe(r1.id + 1);
    });

    it("returns null for nonexistent ID", () => {
      expect(db.getMediaById(99999)).toBeNull();
    });
  });

  describe("getAllMedia", () => {
    it("filters by type", () => {
      const images = db.getAllMedia("image");
      const videos = db.getAllMedia("video");
      // Seed: 3 images (ids 2,3,5), 3 videos (ids 1,4,6)
      expect(images).toHaveLength(3);
      expect(videos).toHaveLength(3);
    });

    it("filters by source", () => {
      expect(db.getAllMedia("image", "uploaded")).toHaveLength(1);
      expect(db.getAllMedia("image", "generated")).toHaveLength(2);
      expect(db.getAllMedia("video", "uploaded")).toHaveLength(1);
      expect(db.getAllMedia("video", "generated")).toHaveLength(2);
    });

    it("returns newest first", () => {
      const all = db.getAllMedia();
      for (let i = 1; i < all.length; i++) {
        expect(all[i - 1].created_at >= all[i].created_at).toBe(true);
      }
    });
  });

  describe("getLatestMedia / getDefaultWallpaper", () => {
    it("returns the newest record of a type", () => {
      const latest = db.getLatestMedia("video");
      expect(latest).not.toBeNull();
      expect(latest!.id).toBe(6); // generated_600.mp4 is newest video
    });

    it("getDefaultWallpaper prefers video over image", () => {
      const def = db.getDefaultWallpaper();
      expect(def).not.toBeNull();
      expect(def!.type).toBe("video");
      expect(def!.id).toBe(6);
    });

    it("getDefaultWallpaper falls back to image when no videos", () => {
      // Remove all videos from the store
      for (const v of db.getAllMedia("video")) db.deleteMedia(v.id);
      const def = db.getDefaultWallpaper();
      expect(def).not.toBeNull();
      expect(def!.type).toBe("image");
    });
  });

  describe("searchByTag / updateTags", () => {
    it("finds records by tag from seed data", () => {
      expect(db.searchByTag("bundled")).toHaveLength(2);
      expect(db.searchByTag("image-to-video")).toHaveLength(2);
      expect(db.searchByTag("character")).toHaveLength(1);
      expect(db.searchByTag("nonexistent")).toHaveLength(0);
    });

    it("updates tags on a record", () => {
      db.updateTags(2, ["uploaded", "sprite", "main-character"]);
      const found = db.getMediaById(2);
      expect(found!.tags).toEqual(["uploaded", "sprite", "main-character"]);
    });
  });

  describe("deleteMedia", () => {
    it("removes a record and deletes the file", () => {
      const record = db.getMediaById(3)!;
      expect(fs.existsSync(record.filepath)).toBe(true);

      expect(db.deleteMedia(3)).toBe(true);
      expect(db.getMediaById(3)).toBeNull();
      expect(fs.existsSync(record.filepath)).toBe(false);
      expect(db.getAllMedia("image", "generated")).toHaveLength(1);
    });

    it("returns false for nonexistent ID", () => {
      expect(db.deleteMedia(99999)).toBe(false);
    });
  });

  describe("characters", () => {
    it("seed character exists", () => {
      const c = db.getCharacterById(1);
      expect(c).not.toBeNull();
      expect(c!.name).toBe("Miku");
    });

    it("adds a new character", () => {
      const c = db.addCharacter("Saber");
      expect(c.id).toBe(2); // nextCharacterId after seed
      expect(db.getCharacterById(c.id)).not.toBeNull();
    });

    it("finds character by name (case insensitive)", () => {
      expect(db.getCharacterByName("miku")).not.toBeNull();
      expect(db.getCharacterByName("MIKU")).not.toBeNull();
    });

    it("ensureCharacter reuses existing, creates new", () => {
      const c1 = db.ensureCharacter("Miku");
      expect(c1.id).toBe(1); // reuses seed character
      const c2 = db.ensureCharacter("Rin");
      expect(c2.id).toBe(2); // creates new
      const c3 = db.ensureCharacter("Rin");
      expect(c3.id).toBe(c2.id); // reuses
    });

    it("getMediaByCharacter returns linked media", () => {
      const linked = db.getMediaByCharacter(1);
      // Seed: ids 2,3,4,5,6 are linked to character 1
      expect(linked).toHaveLength(5);
    });

    it("links media to character", () => {
      // id 1 (uploaded video) has no character — link it
      db.linkMediaToCharacter(1, 1);
      const linked = db.getMediaByCharacter(1);
      expect(linked).toHaveLength(6);
      expect(linked.some(r => r.id === 1)).toBe(true);
    });

    it("deleteCharacter unlinks associated media", () => {
      db.deleteCharacter(1);
      expect(db.getCharacterById(1)).toBeNull();

      // All media previously linked to character 1 should be unlinked
      const record = db.getMediaById(2);
      expect(record!.character_id).toBeNull();
    });

    it("getCharacterSprite returns tagged character media", () => {
      const sprite = db.getCharacterSprite(1);
      expect(sprite).not.toBeNull();
      expect(sprite!.id).toBe(2); // uploaded_200.png tagged "character"
      expect(sprite!.tags).toContain("character");
    });
  });

  describe("generated media metadata", () => {
    it("seed data has correct generation metadata", () => {
      const video = db.getMediaById(4)!;
      expect(video.prompt).toBe("Animate with subtle gentle motion");
      expect(video.model).toBe("grok-imagine-video");
      expect(video.duration).toBe(5);
      expect(video.aspect_ratio).toBe("16:9");
      expect(video.resolution).toBe("720p");
      expect(video.source_image_id).toBe(3);
      expect(video.character_id).toBe(1);
    });

    it("stores metadata on newly added generated media", () => {
      const fp = path.join(videosDir, "gen_new.mp4");
      fs.writeFileSync(fp, "data");
      const r = db.addMedia({
        filename: "gen_new.mp4", filepath: fp, type: "video", source: "generated",
        prompt: "lofi study scene", model: "grok-imagine-video",
        tags: ["generated", "ai"], duration: 5,
        aspectRatio: "16:9", resolution: "1080p",
        sourceImageId: 2, characterId: 1,
      });

      const found = db.getMediaById(r.id)!;
      expect(found.prompt).toBe("lofi study scene");
      expect(found.model).toBe("grok-imagine-video");
      expect(found.duration).toBe(5);
      expect(found.aspect_ratio).toBe("16:9");
      expect(found.resolution).toBe("1080p");
      expect(found.source_image_id).toBe(2);
      expect(found.character_id).toBe(1);
    });
  });
});
