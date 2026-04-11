const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'characters.db');
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
const newCharCols = { species: 'TEXT DEFAULT ""', role: 'TEXT DEFAULT ""', backstory: 'TEXT DEFAULT ""', personality: 'TEXT DEFAULT ""', key_passions: 'TEXT DEFAULT ""', what_they_care_about: 'TEXT DEFAULT ""', tone_and_voice: 'TEXT DEFAULT ""', product_skus: 'TEXT DEFAULT "[]"' };
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

  // SAM2 Segmentation
  sam2_model_size: 'large',
  sam2_min_segment_pct: '5',
  sam2_max_segment_pct: '90',
  sam2_confidence: '0.88',

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

const CHAR_TEXT   = ['name','species','role','backstory','personality','key_passions','what_they_care_about','tone_and_voice','first_appeared','status'];
const CHAR_JSON   = ['images','products','quotes','art_styles','product_skus'];
const CHAR_ALL    = [...CHAR_TEXT, ...CHAR_JSON];

const LAND_TEXT   = ['name','description','visual_style','color_palette','themes_and_content','status'];
const LAND_JSON   = ['images','product_skus'];
const LAND_ALL    = [...LAND_TEXT, ...LAND_JSON];

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

  // ── Settings ──────────────────────────────────────────────────
  getAllSettings() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
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
};
