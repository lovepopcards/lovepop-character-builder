const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

// Use the persistent volume at /data when available (Railway), otherwise fall back to local.
// DB_PATH env var overrides everything.
const DATA_DIR = process.env.DB_PATH
  ? path.dirname(process.env.DB_PATH)
  : fs.existsSync('/data') ? '/data' : __dirname;
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'characters.db');

const db = new DatabaseSync(DB_PATH);

// ── Characters table ──────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    species TEXT DEFAULT '',
    role TEXT DEFAULT '',
    backstory TEXT DEFAULT '',
    personality TEXT DEFAULT '',
    key_passions TEXT DEFAULT '',
    what_they_care_about TEXT DEFAULT '',
    tone_and_voice TEXT DEFAULT '',
    images TEXT DEFAULT '[]',
    products TEXT DEFAULT '[]',
    quotes TEXT DEFAULT '[]',
    art_styles TEXT DEFAULT '[]',
    first_appeared TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// Migrate: add new columns to characters if missing
const existingCharCols = db.prepare("PRAGMA table_info(characters)").all().map(r => r.name);
const newCharCols = { species: 'TEXT DEFAULT ""', role: 'TEXT DEFAULT ""', backstory: 'TEXT DEFAULT ""', personality: 'TEXT DEFAULT ""', key_passions: 'TEXT DEFAULT ""', what_they_care_about: 'TEXT DEFAULT ""', tone_and_voice: 'TEXT DEFAULT ""', hook_and_audience: 'TEXT DEFAULT ""', product_skus: 'TEXT DEFAULT "[]"' };
for (const [col, def] of Object.entries(newCharCols)) {
  if (!existingCharCols.includes(col)) db.exec(`ALTER TABLE characters ADD COLUMN ${col} ${def}`);
}

// ── Lands table ───────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS lands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    description TEXT DEFAULT '',
    visual_style TEXT DEFAULT '',
    color_palette TEXT DEFAULT '',
    themes_and_content TEXT DEFAULT '',
    images TEXT DEFAULT '[]',
    product_skus TEXT DEFAULT '[]',
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// Migrate: add product_skus to existing lands tables that predate this column
const existingLandCols = db.prepare("PRAGMA table_info(lands)").all().map(r => r.name);
if (!existingLandCols.includes('product_skus')) {
  db.exec(`ALTER TABLE lands ADD COLUMN product_skus TEXT DEFAULT '[]'`);
}

// ── Sales Cache table ─────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS sales_cache (
    sku           TEXT PRIMARY KEY,
    t12m_revenue  REAL DEFAULT 0,
    t12m_units    REAL DEFAULT 0,
    asp           REAL DEFAULT 0,
    refreshed_at  TEXT DEFAULT (datetime('now'))
  )
`);

// ── Asset Jobs table ──────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS asset_jobs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    status TEXT DEFAULT 'queued',
    source_files TEXT DEFAULT '[]',
    sku_ids TEXT DEFAULT '[]',
    metadata TEXT DEFAULT '{}',
    box_folder TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    segment_count INTEGER DEFAULT 0,
    error_message TEXT DEFAULT ''
  )
`);

// ── Asset Segments table ───────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS asset_segments (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    job_id TEXT REFERENCES asset_jobs(id),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    source_filename TEXT DEFAULT '',
    status TEXT DEFAULT 'pending_review',
    temp_path TEXT DEFAULT '',
    box_file_id TEXT DEFAULT '',
    box_url TEXT DEFAULT '',
    element_label TEXT DEFAULT '',
    element_type TEXT DEFAULT '',
    auto_label TEXT DEFAULT '',
    mask_bbox TEXT DEFAULT '{}',
    metadata TEXT DEFAULT '{}',
    notes TEXT DEFAULT '',
    reviewed_by TEXT DEFAULT '',
    reviewed_at TEXT DEFAULT ''
  )
`);

// ── Asset Library table ───────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS asset_library (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    segment_id TEXT REFERENCES asset_segments(id),
    created_at TEXT DEFAULT (datetime('now')),
    box_file_id TEXT DEFAULT '',
    box_url TEXT DEFAULT '',
    element_label TEXT DEFAULT '',
    element_type TEXT DEFAULT '',
    sku_ids TEXT DEFAULT '[]',
    occasion TEXT DEFAULT '',
    theme TEXT DEFAULT '',
    sub_theme TEXT DEFAULT '',
    art_style TEXT DEFAULT '',
    color_family TEXT DEFAULT '[]',
    content_type TEXT DEFAULT '[]',
    source_filename TEXT DEFAULT '',
    approved_by TEXT DEFAULT '',
    approved_at TEXT DEFAULT '',
    use_count INTEGER DEFAULT 0
  )
`);

// ── Art Styles table ──────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS art_styles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT DEFAULT '',
    theme_agnostic_name TEXT DEFAULT '',
    description TEXT DEFAULT '',
    visual_technique TEXT DEFAULT '',
    color_palette TEXT DEFAULT '',
    mood_and_feel TEXT DEFAULT '',
    characteristic_elements TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    images TEXT DEFAULT '[]',
    product_skus TEXT DEFAULT '[]',
    reference_product_skus TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// Migrations for art_styles
try { db.exec(`ALTER TABLE art_styles ADD COLUMN theme_agnostic_name TEXT DEFAULT ''`); } catch {}
try { db.exec(`ALTER TABLE art_styles ADD COLUMN reference_product_skus TEXT DEFAULT '[]'`); } catch {}


// ── Character Stories/Quotes table ───────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS character_stories (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    character_id TEXT NOT NULL,
    title TEXT DEFAULT '',
    occasion TEXT DEFAULT '',
    land_id TEXT DEFAULT '',
    story_body TEXT DEFAULT '',
    quote TEXT DEFAULT '',
    context TEXT DEFAULT '',
    status TEXT DEFAULT 'draft',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// Migrate: add quote + context columns if they don't exist
const existingStoryCols = db.prepare('PRAGMA table_info(character_stories)').all().map(r => r.name);
if (!existingStoryCols.includes('quote'))   db.exec(`ALTER TABLE character_stories ADD COLUMN quote TEXT DEFAULT ''`);
if (!existingStoryCols.includes('context')) db.exec(`ALTER TABLE character_stories ADD COLUMN context TEXT DEFAULT ''`);

// ── Card Designs table ────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS card_designs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    sku TEXT DEFAULT '',
    name TEXT DEFAULT '',
    status TEXT DEFAULT 'draft',
    product_data TEXT DEFAULT '{}',
    selected_copy TEXT DEFAULT '{}',
    selected_sketch_url TEXT DEFAULT '',
    selected_concept_url TEXT DEFAULT '',
    character_id TEXT DEFAULT '',
    art_style_id TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// ── Card Designs migrations ───────────────────────────────────
const existingCardDesignCols = db.prepare('PRAGMA table_info(card_designs)').all().map(r => r.name);
if (!existingCardDesignCols.includes('sketch_rounds'))  db.exec(`ALTER TABLE card_designs ADD COLUMN sketch_rounds TEXT DEFAULT '[]'`);
if (!existingCardDesignCols.includes('copy_rounds'))    db.exec(`ALTER TABLE card_designs ADD COLUMN copy_rounds TEXT DEFAULT '[]'`);
if (!existingCardDesignCols.includes('concept_rounds')) db.exec(`ALTER TABLE card_designs ADD COLUMN concept_rounds TEXT DEFAULT '[]'`);
if (!existingCardDesignCols.includes('active_module'))  db.exec(`ALTER TABLE card_designs ADD COLUMN active_module TEXT DEFAULT 'copy'`);
if (!existingCardDesignCols.includes('product_title'))    db.exec(`ALTER TABLE card_designs ADD COLUMN product_title TEXT DEFAULT ''`);
if (!existingCardDesignCols.includes('sketch_ref_image')) db.exec(`ALTER TABLE card_designs ADD COLUMN sketch_ref_image TEXT DEFAULT NULL`);
if (!existingCardDesignCols.includes('cover_ref_image')) db.exec(`ALTER TABLE card_designs ADD COLUMN cover_ref_image TEXT DEFAULT NULL`);
// Migrate old 'draft' status values to 'in-development'
db.exec(`UPDATE card_designs SET status = 'in-development' WHERE status = 'draft'`);

// ── Settings table ────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now'))
  )
`);

// Default AI settings
const DEFAULTS = {
  ai_system_prompt: `You are a creative world-builder and character designer for Lovepop, a premium pop-up greeting card and gifting company known for beautiful, intricate paper art. Your job is to help bring Lovepop characters and their worlds to life with warmth, whimsy, and depth. Always respond with valid JSON only — no markdown, no extra text.`,

  // Character instructions
  ai_instruction_name: `The character's full name. Keep it warm, memorable, and evocative. Single word or short two-word names work best.`,
  ai_instruction_species: `The character's species or type (e.g. "field mouse", "honey bee", "woodland fox"). Be specific and charming.`,
  ai_instruction_role: `A one-sentence description of the character's role or purpose in the Lovepop world (e.g. "the unofficial birthday-wish muse of Lovepop Land").`,
  ai_instruction_backstory: `2-4 sentences describing the character's origin story — where they came from, a formative moment, and what shaped who they are today. Should feel storybook-warm.`,
  ai_instruction_personality: `2-3 sentences describing the character's disposition, quirks, and how they engage with the world. Include at least one unexpected or delightful detail.`,
  ai_instruction_key_passions: `List 3 core passions or hobbies, each with a brief (1 sentence) explanation of why it matters to this character. Number them 1, 2, 3.`,
  ai_instruction_what_they_care_about: `1-2 sentences capturing the character's deepest values and what motivates them at their core — the "why" behind everything they do.`,
  ai_instruction_tone_and_voice: `Describe how the character speaks: their tone, cadence, vocabulary quirks, signature phrases, and overall communication style. Include an example quote.`,
  ai_instruction_hook_and_audience: `In 2-3 sentences, describe who this character most resonates with and what makes them distinctly compelling — the emotional "hook" that draws an audience in. Be specific about the type of person who would connect most deeply with this character and why.`,

  // Land instructions
  ai_land_instruction_name: `A beautiful, evocative name for this Lovepop Land. Should feel like a storybook place name — warm, whimsical, and memorable.`,
  ai_land_instruction_description: `2-3 sentences painting a vivid picture of this world. What does it feel like to be there? What makes it magical and distinct?`,
  ai_land_instruction_visual_style: `Describe the art style that defines this land — the medium, technique, and visual aesthetic (e.g. "loose watercolor washes with fine ink line work", "geometric paper-cut layers with deep shadow play").`,
  ai_land_instruction_color_palette: `List 4-6 key colors that define this land's palette, with evocative names (e.g. "Dusty Rose, Sage Green, Warm Cream, Gold Leaf"). Include a brief note on the overall mood the palette creates.`,
  ai_land_instruction_themes_and_content: `List the primary themes, motifs, and content types that appear in this land (e.g. "wildflowers, mushrooms, morning dew, soft woodland creatures, birthday celebrations"). Aim for 6-10 specific elements.`,

  ai_model: 'claude-opus-4-5',

  // Box Integration
  box_client_id: '',
  box_client_secret: '',
  box_enterprise_id: '',
  box_jwt_key_id: '',
  box_private_key: '',
  box_public_key_id: '',
  box_root_folder: '/Asset Library',

  // Segmentation calibration
  sam2_model_size: 'large',
  sam2_min_segment_pct: '2',      // min element width as % of image width
  sam2_max_segment_pct: '60',     // max element area as % of total image
  sam2_confidence: '0.88',
  seg_crop_padding: '20',         // px to add around each bounding box crop
  seg_detail_level: 'standard',   // broad | standard | fine
  seg_tight_boxes: 'true',        // instruct Claude to draw tight bounding boxes

  // Auto-labeling
  asset_auto_label: 'true',
  asset_auto_label_model: 'claude-haiku-4-5',

  // Snowflake connection
  snowflake_account:   '',
  snowflake_username:  '',
  snowflake_password:  '',
  snowflake_warehouse: '',
  snowflake_database:  '',
  snowflake_schema:    'PUBLIC',
  snowflake_role:      '',
  snowflake_query: `SELECT
  sku,
  SUM(t12m_revenue) AS t12m_revenue,
  SUM(t12m_units)   AS t12m_units,
  ROUND(SUM(t12m_revenue) / NULLIF(SUM(t12m_units), 0), 2) AS asp
FROM your_sales_table
WHERE order_date >= DATEADD('month', -12, CURRENT_DATE())
GROUP BY sku`,

  // Art Style generator
  ai_artstyle_image_instructions: `Create a premium visual mood board in a structured grid layout with an overall 4:5 aspect ratio (portrait) based on the reference images. Use consistent spacing, margins, and a refined editorial composition.

There is a blank mood board template in the sample art styles.

The structured grid should feature 10-12 independent and complete illustrations built off of the reference images. Incorporate some of the original art directly into the mood board.

Maintain the level of detail from the original illustration. Maintain line weights.
The illustrations should feel cohesive and belong to the same visual family.
Illustrations should have consistent lighting, consistent perspective style, consistent texture treatment.
Style should ALWAYS be Classic Illustration and NOT feel like digital illustration.

Add a bottom strip with 5–6 color swatches that reflect the palette.

DO NOT use any of the elements from the sample art styles.
DO NOT include any greeting card images or greeting card shapes. It should only include illustrations based on the reference images.`,
  ai_artstyle_instructions: `You are a creative director at Lovepop, a premium pop-up greeting card and gifting company known for beautiful, intricate paper art. You are reviewing a generated mood board alongside the original reference illustrations it was derived from. Use both to write a cohesive, precise art style profile that captures the visual DNA of this illustration aesthetic. Prioritize the original reference illustrations for accuracy — the mood board shows the interpreted direction. Always respond with valid JSON only — no markdown, no extra text.`,
  ai_artstyle_articulation_rules: `Do not use the words "paper", "3D", or "layered" in any field. These characterizations describe the illustration style only — the physical construction of Lovepop products is assumed and should not be reflected in the style description. Focus purely on the visual and artistic qualities of the illustration.`,
  ai_artstyle_samples: '[]',

  // Card Designer
  gemini_api_key: '',
  gemini_model: 'gemini-3.1-flash-image-preview',
  cd_copy_instruction_cover: `Write warm, evocative cover copy (2–8 words). Should be the primary sentiment statement that captures the occasion and connects emotionally with the recipient.`,
  cd_copy_instruction_inside_left: `Write the inside left panel copy (1–3 sentences). This expands on the cover message and creates emotional depth — the heart of what the sender wants to say.`,
  cd_copy_instruction_inside_right: `Write the inside right panel copy. A warm, versatile sentiment that leaves room for the sender to connect personally. Should feel open and inviting.`,
  cd_copy_instruction_sculpture: `Write copy that celebrates the 3D pop-up sculpture (5–15 words). Should feel magical and reference the artwork without being too literal.`,
  cd_copy_instruction_back: `Write the back of card copy (1–2 short lines). Typically a tagline or brief brand message — a lovely, memorable send-off.`,
  cd_sketch_system_prompt: `You are a concept artist at Lovepop, a premium 3D pop-up greeting card company. Create an architectural concept sketch showing the structure and layout of a Lovepop pop-up card. Show both the cover design composition and the inside 3D pop-up sculpture mechanism. Use a clean, technical illustration style that shows depth, layers, fold lines, and pop-up mechanics. Black and white line art only — no color.`,
  cd_sketch_system_prompt_base: `You are a concept artist at Lovepop, a premium 3D pop-up greeting card company. Create an architectural concept sketch showing the structure and layout of a Lovepop pop-up card. Show both the cover design composition and the inside 3D pop-up sculpture mechanism. Use a clean, technical illustration style that shows depth, layers, fold lines, and pop-up mechanics. Black and white line art only — no color.`,
  cd_sketch_fidelity_loose: `Render as a quick, gestural thumbnail sketch — minimal detail, rough pencil strokes, focus on silhouette and composition only. Don't show fine mechanics.`,
  cd_sketch_fidelity_standard: `Render as a clean architectural concept sketch with clear fold lines, layer indications, and readable pop-up mechanics. Medium detail.`,
  cd_sketch_fidelity_tight: `Render as a highly detailed production-ready concept sketch with precise fold lines, layer counts, dimension callouts, and fully resolved pop-up mechanics. Include corner registration marks.`,

  // Quote generator
  ai_quote_instructions: `You are a creative voice for Lovepop, a premium pop-up greeting card company. Generate an authentic, in-character quote for the character described below — the kind of thing they might say on a greeting card or in a brand story. The quote should be warm, specific, and feel genuinely like this character's voice. It should resonate emotionally and be shareable.

Also write a brief context note (1–2 sentences) describing the situation or moment the character is speaking from — setting the scene without retelling the quote itself.`,

  // Land headline image generator
  ai_image_gen_instructions: `You are creating a headline image for a Lovepop greeting card world. Lovepop makes beautiful, intricate paper pop-up art — the images should evoke that same sense of wonder, precision, and warmth.

The headline image should feel like a storybook come to life: lush, layered, luminous, and full of hand-crafted charm. Avoid photorealism. Aim for an illustrative quality — painterly and whimsical, with rich color, fine detail, and a sense of depth and magic.

The image should immediately capture the mood, color palette, and signature themes of the land. It will be used as a hero banner — landscape orientation, wide and cinematic. The composition should feel like a world you want to step into.`,
};

for (const [key, value] of Object.entries(DEFAULTS)) {
  const existing = db.prepare('SELECT key FROM settings WHERE key = ?').get(key);
  if (!existing) db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

// ── Helpers ───────────────────────────────────────────────────
const parseJSON = (val, fallback = []) => { try { return JSON.parse(val); } catch { return fallback; } };

const serializeChar = (row) => ({
  ...row,
  images:       parseJSON(row.images),
  products:     parseJSON(row.products),
  quotes:       parseJSON(row.quotes),
  art_styles:   parseJSON(row.art_styles),
  product_skus: parseJSON(row.product_skus),
});

const serializeLand = (row) => ({
  ...row,
  images:       parseJSON(row.images),
  product_skus: parseJSON(row.product_skus),
});

const serializeArtStyle = (row) => ({
  ...row,
  images:                 parseJSON(row.images),
  product_skus:           parseJSON(row.product_skus),
  reference_product_skus: parseJSON(row.reference_product_skus),
});

const CHAR_TEXT   = ['name','species','role','backstory','personality','key_passions','what_they_care_about','tone_and_voice','hook_and_audience','first_appeared','status'];
const CHAR_JSON   = ['images','products','quotes','art_styles','product_skus'];
const CHAR_ALL    = [...CHAR_TEXT, ...CHAR_JSON];

const LAND_TEXT   = ['name','description','visual_style','color_palette','themes_and_content','status'];
const LAND_JSON   = ['images','product_skus'];
const LAND_ALL    = [...LAND_TEXT, ...LAND_JSON];

const ARTSTYLE_TEXT = ['name','theme_agnostic_name','description','visual_technique','color_palette','mood_and_feel','characteristic_elements','status'];
const ARTSTYLE_JSON = ['images','product_skus','reference_product_skus'];
const ARTSTYLE_ALL  = [...ARTSTYLE_TEXT, ...ARTSTYLE_JSON];

// ── Asset JSON field helpers ──────────────────────────────────
const parseAssetJob = (row) => row ? ({
  ...row,
  source_files: parseJSON(row.source_files, []),
  sku_ids:      parseJSON(row.sku_ids, []),
  metadata:     parseJSON(row.metadata, {}),
}) : null;

const parseAssetSegment = (row) => row ? ({
  ...row,
  mask_bbox: parseJSON(row.mask_bbox, {}),
  metadata:  parseJSON(row.metadata, {}),
}) : null;

const parseAssetLibraryItem = (row) => row ? ({
  ...row,
  sku_ids:      parseJSON(row.sku_ids, []),
  color_family: parseJSON(row.color_family, []),
  content_type: parseJSON(row.content_type, []),
}) : null;

module.exports = {

  // ── Characters ──────────────────────────────────────────────
  getAllCharacters() {
    return db.prepare('SELECT * FROM characters ORDER BY created_at DESC').all().map(serializeChar);
  },
  getCharacter(id) {
    const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(id);
    return row ? serializeChar(row) : null;
  },
  createCharacter(data) {
    const result = db.prepare(
      `INSERT INTO characters (${CHAR_ALL.join(', ')}) VALUES (${CHAR_ALL.map(() => '?').join(', ')})`
    ).run(...CHAR_ALL.map(f => CHAR_JSON.includes(f) ? JSON.stringify(data[f] || []) : (data[f] || '')));
    return this.getCharacter(result.lastInsertRowid);
  },
  updateCharacter(id, data) {
    const fields = [], values = [];
    for (const key of CHAR_ALL) {
      if (data[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(CHAR_JSON.includes(key) ? JSON.stringify(data[key]) : data[key]);
      }
    }
    if (!fields.length) return this.getCharacter(id);
    fields.push(`updated_at = datetime('now')`);
    values.push(id);
    db.prepare(`UPDATE characters SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getCharacter(id);
  },
  deleteCharacter(id) {
    return db.prepare('DELETE FROM characters WHERE id = ?').run(id);
  },

  // ── Lands ────────────────────────────────────────────────────
  getAllLands() {
    return db.prepare('SELECT * FROM lands ORDER BY created_at DESC').all().map(serializeLand);
  },
  getLand(id) {
    const row = db.prepare('SELECT * FROM lands WHERE id = ?').get(id);
    return row ? serializeLand(row) : null;
  },
  createLand(data) {
    const result = db.prepare(
      `INSERT INTO lands (${LAND_ALL.join(', ')}) VALUES (${LAND_ALL.map(() => '?').join(', ')})`
    ).run(...LAND_ALL.map(f => LAND_JSON.includes(f) ? JSON.stringify(data[f] || []) : (data[f] || '')));
    return this.getLand(result.lastInsertRowid);
  },
  updateLand(id, data) {
    const fields = [], values = [];
    for (const key of LAND_ALL) {
      if (data[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(LAND_JSON.includes(key) ? JSON.stringify(data[key]) : data[key]);
      }
    }
    if (!fields.length) return this.getLand(id);
    fields.push(`updated_at = datetime('now')`);
    values.push(id);
    db.prepare(`UPDATE lands SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getLand(id);
  },
  deleteLand(id) {
    return db.prepare('DELETE FROM lands WHERE id = ?').run(id);
  },

  // ── Art Styles ───────────────────────────────────────────────
  getAllArtStyles() {
    return db.prepare('SELECT * FROM art_styles ORDER BY created_at DESC').all().map(serializeArtStyle);
  },
  getArtStyle(id) {
    const row = db.prepare('SELECT * FROM art_styles WHERE id = ?').get(id);
    return row ? serializeArtStyle(row) : null;
  },
  createArtStyle(data) {
    const result = db.prepare(
      `INSERT INTO art_styles (${ARTSTYLE_ALL.join(', ')}) VALUES (${ARTSTYLE_ALL.map(() => '?').join(', ')})`
    ).run(...ARTSTYLE_ALL.map(f => ARTSTYLE_JSON.includes(f) ? JSON.stringify(data[f] || []) : (data[f] || '')));
    return this.getArtStyle(result.lastInsertRowid);
  },
  updateArtStyle(id, data) {
    const fields = [], values = [];
    for (const key of ARTSTYLE_ALL) {
      if (data[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(ARTSTYLE_JSON.includes(key) ? JSON.stringify(data[key]) : data[key]);
      }
    }
    if (!fields.length) return this.getArtStyle(id);
    fields.push(`updated_at = datetime('now')`);
    values.push(id);
    db.prepare(`UPDATE art_styles SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getArtStyle(id);
  },
  deleteArtStyle(id) {
    return db.prepare('DELETE FROM art_styles WHERE id = ?').run(id);
  },
  updateArtStyleImages(id, images) {
    db.prepare(`UPDATE art_styles SET images = ?, updated_at = datetime('now') WHERE id = ?`).run(JSON.stringify(images), id);
    return this.getArtStyle(id);
  },

  // ── Settings ──────────────────────────────────────────────────
  getAllSettings() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const fromDb = Object.fromEntries(rows.map(r => [r.key, r.value]));
    // Merge with DEFAULTS so every known key always has a value even if not yet in DB
    return { ...DEFAULTS, ...fromDb };
  },
  getSetting(key) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : (DEFAULTS[key] || '');
  },
  setSetting(key, value) {
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(key, value);
  },
  setSettings(obj) {
    for (const [key, value] of Object.entries(obj)) this.setSetting(key, value);
  },

  // ── Sales Cache ───────────────────────────────────────────────
  getAllSales() {
    const rows = db.prepare('SELECT * FROM sales_cache').all();
    return Object.fromEntries(rows.map(r => [r.sku, r]));
  },
  upsertSalesCache(rows) {
    const stmt = db.prepare(`
      INSERT INTO sales_cache (sku, t12m_revenue, t12m_units, asp, refreshed_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(sku) DO UPDATE SET
        t12m_revenue = excluded.t12m_revenue,
        t12m_units   = excluded.t12m_units,
        asp          = excluded.asp,
        refreshed_at = excluded.refreshed_at
    `);
    // Snowflake returns uppercase column names by default
    for (const row of rows) {
      stmt.run(
        row.SKU          ?? row.sku          ?? '',
        row.T12M_REVENUE ?? row.t12m_revenue ?? 0,
        row.T12M_UNITS   ?? row.t12m_units   ?? 0,
        row.ASP          ?? row.asp          ?? 0,
      );
    }
  },
  getSalesStatus() {
    const row = db.prepare(`
      SELECT COUNT(*) AS sku_count, MAX(refreshed_at) AS last_refresh
      FROM sales_cache
    `).get();
    return { sku_count: row.sku_count || 0, last_refresh: row.last_refresh || null };
  },

  DEFAULTS,

  // ── Character Stories ─────────────────────────────────────────
  listStoriesForCharacter(characterId) {
    return db.prepare('SELECT * FROM character_stories WHERE character_id = ? ORDER BY created_at DESC').all(String(characterId));
  },
  getStory(id) {
    return db.prepare('SELECT * FROM character_stories WHERE id = ?').get(id) || null;
  },
  createStory(data) {
    const { character_id, title = '', occasion = '', land_id = '', story_body = '', quote = '', context = '', status = 'draft' } = data;
    db.prepare(`
      INSERT INTO character_stories (character_id, title, occasion, land_id, story_body, quote, context, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(String(character_id), title, occasion, land_id, story_body, quote, context, status);
    return db.prepare('SELECT * FROM character_stories WHERE rowid = last_insert_rowid()').get();
  },
  updateStory(id, data) {
    const allowed = ['title','occasion','land_id','story_body','quote','context','status'];
    const fields = [], values = [];
    for (const key of allowed) {
      if (data[key] !== undefined) { fields.push(`${key} = ?`); values.push(data[key]); }
    }
    if (!fields.length) return this.getStory(id);
    fields.push(`updated_at = datetime('now')`);
    values.push(id);
    db.prepare(`UPDATE character_stories SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getStory(id);
  },
  deleteStory(id) {
    return db.prepare('DELETE FROM character_stories WHERE id = ?').run(id);
  },

  // ── Asset Jobs ────────────────────────────────────────────────
  createAssetJob(data) {
    const fields = ['status','source_files','sku_ids','metadata','box_folder','notes','segment_count','error_message'];
    const jsonFields = ['source_files','sku_ids','metadata'];
    const vals = fields.map(f => jsonFields.includes(f) ? JSON.stringify(data[f] != null ? data[f] : (f === 'metadata' ? {} : [])) : (data[f] != null ? data[f] : ''));
    db.prepare(`INSERT INTO asset_jobs (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`).run(...vals);
    const row = db.prepare('SELECT * FROM asset_jobs ORDER BY rowid DESC LIMIT 1').get();
    return parseAssetJob(row);
  },
  updateAssetJob(id, data) {
    const jsonFields = ['source_files','sku_ids','metadata'];
    const fields = [], values = [];
    for (const [k, v] of Object.entries(data)) {
      fields.push(`${k} = ?`);
      values.push(jsonFields.includes(k) ? JSON.stringify(v) : v);
    }
    if (!fields.length) return;
    fields.push(`updated_at = datetime('now')`);
    values.push(id);
    db.prepare(`UPDATE asset_jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  },
  getAssetJob(id) {
    return parseAssetJob(db.prepare('SELECT * FROM asset_jobs WHERE id = ?').get(id));
  },
  listAssetJobs() {
    return db.prepare('SELECT * FROM asset_jobs ORDER BY created_at DESC').all().map(parseAssetJob);
  },
  deleteAssetJob(id) {
    return db.prepare('DELETE FROM asset_jobs WHERE id = ?').run(id);
  },

  // ── Asset Segments ────────────────────────────────────────────
  createAssetSegment(data) {
    const fields = ['job_id','source_filename','status','temp_path','box_file_id','box_url','element_label','element_type','auto_label','mask_bbox','metadata','notes','reviewed_by','reviewed_at'];
    const jsonFields = ['mask_bbox','metadata'];
    const vals = fields.map(f => jsonFields.includes(f) ? JSON.stringify(data[f] != null ? data[f] : (f === 'metadata' ? {} : {})) : (data[f] != null ? data[f] : ''));
    db.prepare(`INSERT INTO asset_segments (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`).run(...vals);
    const row = db.prepare('SELECT * FROM asset_segments ORDER BY rowid DESC LIMIT 1').get();
    return parseAssetSegment(row);
  },
  updateAssetSegment(id, data) {
    const jsonFields = ['mask_bbox','metadata'];
    const fields = [], values = [];
    for (const [k, v] of Object.entries(data)) {
      fields.push(`${k} = ?`);
      values.push(jsonFields.includes(k) ? JSON.stringify(v) : v);
    }
    if (!fields.length) return;
    fields.push(`updated_at = datetime('now')`);
    values.push(id);
    db.prepare(`UPDATE asset_segments SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  },
  getAssetSegment(id) {
    return parseAssetSegment(db.prepare('SELECT * FROM asset_segments WHERE id = ?').get(id));
  },
  listSegmentsForJob(jobId) {
    return db.prepare('SELECT * FROM asset_segments WHERE job_id = ? ORDER BY created_at ASC').all(jobId).map(parseAssetSegment);
  },
  deleteSegment(id) {
    return db.prepare('DELETE FROM asset_segments WHERE id = ?').run(id);
  },

  // ── Asset Library ─────────────────────────────────────────────
  addToAssetLibrary(data) {
    const fields = ['segment_id','box_file_id','box_url','element_label','element_type','sku_ids','occasion','theme','sub_theme','art_style','color_family','content_type','source_filename','approved_by','approved_at','use_count'];
    const jsonFields = ['sku_ids','color_family','content_type'];
    const vals = fields.map(f => jsonFields.includes(f) ? JSON.stringify(data[f] != null ? data[f] : []) : (data[f] != null ? data[f] : ''));
    db.prepare(`INSERT INTO asset_library (${fields.join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`).run(...vals);
    const row = db.prepare('SELECT * FROM asset_library ORDER BY rowid DESC LIMIT 1').get();
    return parseAssetLibraryItem(row);
  },
  getAssetLibraryItem(id) {
    return parseAssetLibraryItem(db.prepare('SELECT * FROM asset_library WHERE id = ?').get(id));
  },
  listAssetLibrary(filters = {}) {
    const conditions = [];
    const params = [];
    if (filters.occasion) { conditions.push('occasion = ?'); params.push(filters.occasion); }
    if (filters.art_style) { conditions.push('art_style = ?'); params.push(filters.art_style); }
    if (filters.element_type) { conditions.push('element_type = ?'); params.push(filters.element_type); }
    if (filters.color_family) { conditions.push('color_family LIKE ?'); params.push(`%${filters.color_family}%`); }
    if (filters.search) {
      conditions.push('(element_label LIKE ? OR source_filename LIKE ? OR theme LIKE ?)');
      params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return db.prepare(`SELECT * FROM asset_library ${where} ORDER BY created_at DESC LIMIT 200`).all(...params).map(parseAssetLibraryItem);
  },

  // ── Card Designs ──────────────────────────────────────────────
  _parseCardDesign(row) {
    if (!row) return null;
    return {
      ...row,
      product_data:   parseJSON(row.product_data, {}),
      selected_copy:  parseJSON(row.selected_copy, {}),
      sketch_rounds:  parseJSON(row.sketch_rounds, []),
      copy_rounds:    parseJSON(row.copy_rounds, []),
      concept_rounds: parseJSON(row.concept_rounds, []),
    };
  },
  getAllCardDesigns() {
    return db.prepare('SELECT * FROM card_designs ORDER BY created_at DESC').all().map(r => this._parseCardDesign(r));
  },
  getCardDesign(id) {
    return this._parseCardDesign(db.prepare('SELECT * FROM card_designs WHERE id = ?').get(id));
  },
  createCardDesign(data) {
    const { name = '', sku = '', status = 'in-development', product_data = {}, notes = '' } = data;
    db.prepare(`
      INSERT INTO card_designs (name, sku, status, product_data, notes)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, sku, status, JSON.stringify(product_data), notes);
    return this._parseCardDesign(db.prepare('SELECT * FROM card_designs ORDER BY rowid DESC LIMIT 1').get());
  },
  updateCardDesign(id, data) {
    const jsonFields = ['product_data', 'selected_copy', 'sketch_rounds', 'copy_rounds', 'concept_rounds'];
    const allowed = ['name', 'sku', 'status', 'product_data', 'product_title', 'selected_copy', 'selected_sketch_url', 'selected_concept_url', 'character_id', 'art_style_id', 'notes', 'sketch_rounds', 'copy_rounds', 'concept_rounds', 'active_module', 'sketch_ref_image', 'cover_ref_image'];
    const fields = [], values = [];
    for (const key of allowed) {
      if (data[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(jsonFields.includes(key) ? JSON.stringify(data[key]) : data[key]);
      }
    }
    if (!fields.length) return this.getCardDesign(id);
    fields.push(`updated_at = datetime('now')`);
    values.push(id);
    db.prepare(`UPDATE card_designs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getCardDesign(id);
  },
  deleteCardDesign(id) {
    return db.prepare('DELETE FROM card_designs WHERE id = ?').run(id);
  },
  getCharacterNamesMap() {
    return Object.fromEntries(db.prepare('SELECT id, name FROM characters').all().map(r => [String(r.id), r.name || '']));
  },
  getArtStyleNamesMap() {
    return Object.fromEntries(db.prepare('SELECT id, name FROM art_styles').all().map(r => [String(r.id), r.name || '']));
  },
};
