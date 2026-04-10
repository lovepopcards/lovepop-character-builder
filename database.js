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

  DEFAULTS,
};
