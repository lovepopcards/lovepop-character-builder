const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Uploads dir — use the same persistent volume as the DB when available
const DATA_DIR = process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : null;
const UPLOADS_DIR = DATA_DIR
  ? path.join(DATA_DIR, 'uploads')
  : path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Image samples dir — lives inside uploads so it shares the same persistent volume
const IMAGE_SAMPLES_DIR = path.join(UPLOADS_DIR, 'image-samples');
if (!fs.existsSync(IMAGE_SAMPLES_DIR)) fs.mkdirSync(IMAGE_SAMPLES_DIR, { recursive: true });

const diskStorage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const sampleStorage = multer.diskStorage({
  destination: IMAGE_SAMPLES_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `sample-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const uploadDisk   = multer({ storage: diskStorage,  limits: { fileSize: 10 * 1024 * 1024 } });
const uploadMem    = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const uploadSample = multer({ storage: sampleStorage, limits: { fileSize: 15 * 1024 * 1024 } });

app.use(express.json({ limit: '10mb' }));
// Serve uploads from the persistent volume at /uploads/ (takes priority over public/uploads/)
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// ── Characters API ────────────────────────────────────────────
app.get('/api/characters', (req, res) => res.json(db.getAllCharacters()));
app.get('/api/characters/:id', (req, res) => {
  const row = db.getCharacter(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});
app.post('/api/characters', (req, res) => {
  try { res.status(201).json(db.createCharacter(req.body)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
app.put('/api/characters/:id', (req, res) => {
  try { res.json(db.updateCharacter(req.params.id, req.body)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
app.delete('/api/characters/:id', (req, res) => {
  db.deleteCharacter(req.params.id);
  res.json({ success: true });
});
app.post('/api/characters/:id/images', uploadDisk.single('image'), (req, res) => {
  const char = db.getCharacter(req.params.id);
  if (!char) return res.status(404).json({ error: 'Not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const updated = db.updateCharacter(req.params.id, { images: [...char.images, `/uploads/${req.file.filename}`] });
  res.json(updated);
});
app.delete('/api/characters/:id/images/:index', (req, res) => {
  const char = db.getCharacter(req.params.id);
  if (!char) return res.status(404).json({ error: 'Not found' });
  const idx = parseInt(req.params.index, 10);
  if (isNaN(idx) || idx < 0 || idx >= char.images.length) return res.status(400).json({ error: 'Invalid index' });
  const newImages = char.images.filter((_, i) => i !== idx);
  res.json(db.updateCharacter(req.params.id, { images: newImages }));
});

// ── Lands API ─────────────────────────────────────────────────
app.get('/api/lands', (req, res) => res.json(db.getAllLands()));
app.get('/api/lands/:id', (req, res) => {
  const row = db.getLand(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});
app.post('/api/lands', (req, res) => {
  try { res.status(201).json(db.createLand(req.body)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
app.put('/api/lands/:id', (req, res) => {
  try { res.json(db.updateLand(req.params.id, req.body)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
app.delete('/api/lands/:id', (req, res) => {
  db.deleteLand(req.params.id);
  res.json({ success: true });
});
app.post('/api/lands/:id/images', uploadDisk.single('image'), (req, res) => {
  const land = db.getLand(req.params.id);
  if (!land) return res.status(404).json({ error: 'Not found' });
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const updated = db.updateLand(req.params.id, { images: [...land.images, `/uploads/${req.file.filename}`] });
  res.json(updated);
});
app.delete('/api/lands/:id/images/:index', (req, res) => {
  const land = db.getLand(req.params.id);
  if (!land) return res.status(404).json({ error: 'Not found' });
  const idx = parseInt(req.params.index, 10);
  if (isNaN(idx) || idx < 0 || idx >= land.images.length) return res.status(400).json({ error: 'Invalid index' });
  const newImages = land.images.filter((_, i) => i !== idx);
  res.json(db.updateLand(req.params.id, { images: newImages }));
});

// ── Settings API ──────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  const settings = db.getAllSettings();
  const apiKeySet    = !!(process.env.ANTHROPIC_API_KEY || settings.anthropic_api_key);
  const openaiKeySet = !!(process.env.OPENAI_API_KEY    || settings.openai_api_key);
  res.json({ ...settings, anthropic_api_key: undefined, openai_api_key: undefined,
             api_key_configured: apiKeySet, openai_key_configured: openaiKeySet });
});
app.put('/api/settings', (req, res) => {
  db.setSettings(req.body);
  res.json({ success: true });
});
app.get('/api/settings/api-key-status', (req, res) => {
  const envKey = process.env.ANTHROPIC_API_KEY;
  const dbKey  = db.getSetting('anthropic_api_key');
  res.json({ configured: !!(envKey || dbKey), source: envKey ? 'env' : dbKey ? 'db' : 'none' });
});

// ── AI Generate — shared helper ───────────────────────────────
async function runAI({ req, res, fieldLabels, instructionPrefix }) {
  const apiKey = process.env.ANTHROPIC_API_KEY || db.getSetting('anthropic_api_key');
  if (!apiKey) return res.status(400).json({ error: 'Anthropic API key not configured.' });

  const anthropic = new Anthropic({ apiKey });
  const settings  = db.getAllSettings();
  const { description = '' } = req.body;

  // Wrap each field instruction in <…> so Claude reads them as placeholders,
  // not as the literal JSON value. This prevents it from returning the
  // instruction text as the value or skipping fields like key_passions.
  const schemaLines = Object.entries(fieldLabels).map(([key, label]) => {
    const instruction = settings[`${instructionPrefix}${key}`] || db.DEFAULTS[`${instructionPrefix}${key}`] || label;
    return `  "${key}": "<${instruction}>"`;
  }).join(',\n');

  const userContent = [];

  // Single uploaded file (drag-drop or file picker)
  if (req.file) {
    userContent.push({ type: 'image', source: { type: 'base64', media_type: req.file.mimetype, data: req.file.buffer.toString('base64') } });
  }

  // Multiple product image URLs from the product picker (up to 5)
  if (req.body.image_urls) {
    try {
      const urls = JSON.parse(req.body.image_urls);
      for (const url of urls.slice(0, 5)) {
        if (!url.startsWith('https://cdn.shopify.com/')) continue;
        const imgResp = await fetch(url);
        if (!imgResp.ok) continue;
        const buf = Buffer.from(await imgResp.arrayBuffer());
        const ct  = imgResp.headers.get('content-type') || 'image/jpeg';
        userContent.push({ type: 'image', source: { type: 'base64', media_type: ct, data: buf.toString('base64') } });
      }
    } catch (e) { console.warn('image_urls parse/fetch error:', e.message); }
  }

  userContent.push({
    type: 'text',
    text: [
      userContent.length > 1 && !req.file ? `You are given ${userContent.length} product image${userContent.length > 1 ? 's' : ''} as visual reference. Synthesise a cohesive aesthetic from all of them.\n` : '',
      description ? `Description / notes:\n${description}\n` : '',
      `Generate a profile as a JSON object using EXACTLY these field names.`,
      `Every value must be a plain string — never an array or nested object.`,
      `Replace each <…> placeholder with the generated content:`,
      `{\n${schemaLines}\n}`,
      `\nRespond with valid JSON only — no markdown fences, no extra text.`,
    ].filter(Boolean).join('\n'),
  });

  try {
    const response = await anthropic.messages.create({
      model: settings.ai_model || db.DEFAULTS.ai_model,
      max_tokens: 4096,   // raised from 2048 — verbose fields like backstory were consuming the budget before key_passions
      system: settings.ai_system_prompt || db.DEFAULTS.ai_system_prompt,
      messages: [{ role: 'user', content: userContent }],
    });
    const rawText = response.content[0].text.trim();
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');
    const parsed = JSON.parse(jsonMatch[0]);

    // Safety-net: if Claude still returns an array or object for any field,
    // normalise it to a plain string so the UI can always render it.
    for (const key of Object.keys(parsed)) {
      if (Array.isArray(parsed[key])) {
        parsed[key] = parsed[key].join('\n');
      } else if (parsed[key] !== null && typeof parsed[key] === 'object') {
        parsed[key] = Object.entries(parsed[key]).map(([k, v]) => `${k}. ${v}`).join('\n');
      }
    }

    res.json(parsed);
  } catch (err) {
    console.error('AI error:', err);
    res.status(500).json({ error: err.message || 'AI generation failed' });
  }
}

// Character generation
app.post('/api/ai/generate', uploadMem.single('image'), (req, res) =>
  runAI({ req, res, instructionPrefix: 'ai_instruction_', fieldLabels: {
    name: 'Name', species: 'Species', role: 'Role', backstory: 'Backstory',
    personality: 'Personality', key_passions: 'Key Passions',
    what_they_care_about: 'What They Care About', tone_and_voice: 'Tone & Voice',
  }})
);

// Land generation
app.post('/api/ai/generate-land', uploadMem.single('image'), (req, res) =>
  runAI({ req, res, instructionPrefix: 'ai_land_instruction_', fieldLabels: {
    name: 'Name', description: 'Description', visual_style: 'Visual Style',
    color_palette: 'Color Palette', themes_and_content: 'Themes & Content',
  }})
);

// ── Image Sample endpoints (for Land Image Generator settings) ─
app.get('/api/settings/image-samples', (req, res) => {
  const raw = db.getSetting('ai_image_gen_samples');
  const samples = (() => { try { return JSON.parse(raw || '[]'); } catch { return []; } })();
  res.json({ samples });
});

app.post('/api/settings/image-samples', uploadSample.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const imgPath = `/uploads/image-samples/${req.file.filename}`;
  const raw = db.getSetting('ai_image_gen_samples');
  const current = (() => { try { return JSON.parse(raw || '[]'); } catch { return []; } })();
  current.push(imgPath);
  db.setSetting('ai_image_gen_samples', JSON.stringify(current));
  res.json({ path: imgPath, samples: current });
});

app.delete('/api/settings/image-samples/:filename', (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join(IMAGE_SAMPLES_DIR, filename);
  if (fs.existsSync(filepath)) { try { fs.unlinkSync(filepath); } catch (e) { console.warn('Could not delete sample:', e.message); } }
  const raw = db.getSetting('ai_image_gen_samples');
  const current = (() => { try { return JSON.parse(raw || '[]'); } catch { return []; } })();
  const updated = current.filter(p => !p.endsWith('/' + filename));
  db.setSetting('ai_image_gen_samples', JSON.stringify(updated));
  res.json({ success: true, samples: updated });
});

// ── Land Headline Image Generator ─────────────────────────────
app.post('/api/ai/generate-land-image', async (req, res) => {
  const openaiKey   = process.env.OPENAI_API_KEY  || db.getSetting('openai_api_key');
  const anthropicKey = process.env.ANTHROPIC_API_KEY || db.getSetting('anthropic_api_key');
  if (!openaiKey) return res.status(400).json({ error: 'OpenAI API key not configured. Add it in Settings to use image generation.' });

  const settings = db.getAllSettings();
  const instructions = settings.ai_image_gen_instructions || db.DEFAULTS.ai_image_gen_instructions;

  // Land context — client sends current form values (works for unsaved lands too)
  const { name = '', description = '', visual_style = '', color_palette = '', themes_and_content = '', product_names = [] } = req.body;

  // ── Step 1: Build the DALL-E prompt ──────────────────────────
  // If Anthropic key available + sample images exist, use Claude vision to write a richer prompt.
  // Otherwise fall back to a template-built prompt.
  let dallePrompt = '';

  const rawSamples = db.getSetting('ai_image_gen_samples');
  const samplePaths = (() => { try { return JSON.parse(rawSamples || '[]'); } catch { return []; } })();

  if (anthropicKey) {
    // Build Claude request — optionally include sample images for style reference
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const userContent = [];

    // Load up to 3 sample images from disk
    for (const sp of samplePaths.slice(0, 3)) {
      const filename = path.basename(sp);
      const fullPath = path.join(IMAGE_SAMPLES_DIR, filename);
      if (!fs.existsSync(fullPath)) continue;
      try {
        const buf  = fs.readFileSync(fullPath);
        const ext  = path.extname(fullPath).slice(1).toLowerCase();
        const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        userContent.push({ type: 'image', source: { type: 'base64', media_type: mime, data: buf.toString('base64') } });
      } catch (e) { console.warn('Could not load sample image:', e.message); }
    }

    const productContext = Array.isArray(product_names) && product_names.length
      ? `\nFeatured products in this land:\n${product_names.slice(0, 8).map(n => `- ${n}`).join('\n')}`
      : '';

    userContent.push({
      type: 'text',
      text: [
        userContent.length > 0 ? `I've provided ${userContent.length} sample headline image${userContent.length > 1 ? 's' : ''} above that represent the visual style and quality standard. Study them carefully and match that aesthetic.\n` : '',
        `INSTRUCTIONS FOR THIS IMAGE:\n${instructions}\n`,
        `LAND DATA:`,
        `Name: ${name || '(untitled)'}`,
        `Description: ${description || '(none)'}`,
        `Visual Style: ${visual_style || '(none)'}`,
        `Color Palette: ${color_palette || '(none)'}`,
        `Themes & Content: ${themes_and_content || '(none)'}`,
        productContext,
        `\nWrite a single, detailed DALL-E 3 image generation prompt (150–220 words) for this land's headline image.`,
        `Be specific about composition, lighting, color, texture, and mood.`,
        `Output ONLY the prompt text — no preamble, no markdown, no quotes.`,
      ].filter(Boolean).join('\n'),
    });

    try {
      const promptResp = await anthropic.messages.create({
        model: settings.ai_model || db.DEFAULTS.ai_model,
        max_tokens: 512,
        system: 'You write DALL-E 3 image generation prompts. Output only the raw prompt text.',
        messages: [{ role: 'user', content: userContent }],
      });
      dallePrompt = promptResp.content[0].text.trim();
    } catch (e) {
      console.warn('Claude prompt-building failed, using template:', e.message);
    }
  }

  // Fallback: template-built prompt
  if (!dallePrompt) {
    const productLine = Array.isArray(product_names) && product_names.length
      ? ` Featuring elements inspired by: ${product_names.slice(0, 5).join(', ')}.`
      : '';
    dallePrompt = [
      instructions,
      `\nLand: "${name || 'Lovepop Land'}"`,
      description ? `World description: ${description}` : '',
      visual_style ? `Visual style: ${visual_style}` : '',
      color_palette ? `Color palette: ${color_palette}` : '',
      themes_and_content ? `Key themes and motifs: ${themes_and_content}` : '',
      productLine,
      `\nComposition: wide landscape, cinematic hero image, rich detail, luminous lighting.`,
    ].filter(Boolean).join('\n');
  }

  // ── Step 2: Call DALL-E 3 ─────────────────────────────────────
  try {
    const dalleResp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: dallePrompt,
        size: '1792x1024',
        quality: 'hd',
        n: 1,
      }),
    });

    if (!dalleResp.ok) {
      const errBody = await dalleResp.json().catch(() => ({}));
      throw new Error(errBody.error?.message || `DALL-E API error ${dalleResp.status}`);
    }

    const dalleData = await dalleResp.json();
    const imageUrl  = dalleData.data[0].url;

    // ── Step 3: Download & persist the image ──────────────────────
    const imgResp = await fetch(imageUrl);
    if (!imgResp.ok) throw new Error('Failed to download generated image from OpenAI');
    const imgBuf  = Buffer.from(await imgResp.arrayBuffer());
    const filename = `gen-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), imgBuf);

    res.json({ image_url: `/uploads/${filename}`, dalle_prompt: dallePrompt });
  } catch (err) {
    console.error('Image generation error:', err);
    res.status(500).json({ error: err.message || 'Image generation failed' });
  }
});

// ── Product Library Proxy ─────────────────────────────────────
let _productCache = null;
let _productCacheTs = 0;
const PRODUCT_CACHE_TTL = 60 * 60 * 1000; // 1 hour

app.get('/api/products', async (req, res) => {
  try {
    const now = Date.now();
    if (_productCache && (now - _productCacheTs) < PRODUCT_CACHE_TTL) {
      return res.json(_productCache);
    }
    const upstream = await fetch('https://lovepop-merch-tool-production.up.railway.app/api/products');
    if (!upstream.ok) throw new Error(`Upstream responded ${upstream.status}`);
    _productCache = await upstream.json();
    _productCacheTs = now;
    res.json(_productCache);
  } catch (err) {
    console.error('Products proxy error:', err.message);
    if (_productCache) return res.json(_productCache); // serve stale cache on upstream error
    res.status(502).json({ error: 'Could not load product library: ' + err.message });
  }
});

// Proxy Shopify CDN images so the browser avoids any CORS issues
app.get('/api/image-proxy', async (req, res) => {
  const { url } = req.query;
  if (!url || !url.startsWith('https://cdn.shopify.com/')) {
    return res.status(400).json({ error: 'Only Shopify CDN URLs are allowed' });
  }
  try {
    const upstream = await fetch(url);
    if (!upstream.ok) throw new Error(`Image fetch failed: ${upstream.status}`);
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.set('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Diagnostic
app.get('/api/debug/db-path', (req, res) => {
  const dbPath = process.env.DB_PATH || path.join(__dirname, 'characters.db');
  res.json({
    db_path: dbPath,
    db_path_source: process.env.DB_PATH ? 'env var (good — persistent)' : 'local filesystem (bad — wiped on redeploy)',
    exists: fs.existsSync(dbPath),
    env_DB_PATH: process.env.DB_PATH || '(not set)',
  });
});

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  const dbPath = process.env.DB_PATH || path.join(__dirname, 'characters.db');
  console.log(`Lovepop Character Builder → http://localhost:${PORT}`);
  console.log(`DB_PATH env var: ${process.env.DB_PATH || '(not set — using local filesystem)'}`);
  console.log(`Database location: ${dbPath}`);
  console.log(`Database exists: ${fs.existsSync(dbPath)}`);
  console.log(`Uploads directory: ${UPLOADS_DIR}`);
  console.log(`Uploads dir exists: ${fs.existsSync(UPLOADS_DIR)}`);
  console.log(`/data directory exists: ${fs.existsSync('/data')}`);
});
