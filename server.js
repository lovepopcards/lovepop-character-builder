const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const sharp = require('sharp');
const db = require('./database');
const { anthropicMessages } = require('./utils/anthropic');
const assetLibraryRouter = require('./routes/assetLibrary');

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

// ── Character Stories API ─────────────────────────────────────
app.get('/api/characters/:id/stories', (req, res) => {
  try { res.json(db.listStoriesForCharacter(req.params.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/characters/:id/stories', (req, res) => {
  try {
    const story = db.createStory({ ...req.body, character_id: req.params.id });
    res.status(201).json(story);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/characters/:id/stories/:storyId', (req, res) => {
  try {
    const story = db.updateStory(req.params.storyId, req.body);
    if (!story) return res.status(404).json({ error: 'Not found' });
    res.json(story);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/characters/:id/stories/:storyId', (req, res) => {
  try { db.deleteStory(req.params.storyId); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// AI: generate a quote draft for a character
app.post('/api/characters/:id/stories/generate', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY || db.getSetting('anthropic_api_key');
  if (!apiKey) return res.status(400).json({ error: 'Anthropic API key not configured.' });

  const char = db.getCharacter(req.params.id);
  if (!char) return res.status(404).json({ error: 'Character not found' });

  const { occasion = '', direction = '' } = req.body;

  const systemPrompt = db.getSetting('ai_quote_instructions') || db.DEFAULTS.ai_quote_instructions;
  const occasionLine = occasion ? `\nOCCASION: ${occasion}` : '';
  const directionLine = direction ? `\nDIRECTION / NOTES: ${direction}` : '';

  const prompt = `${systemPrompt}

CHARACTER:
Name: ${char.name || 'Unknown'}
Species: ${char.species || ''}
Role: ${char.role || ''}
Backstory: ${char.backstory || ''}
Personality: ${char.personality || ''}
Key Passions: ${char.key_passions || ''}
What They Care About: ${char.what_they_care_about || ''}
Tone & Voice: ${char.tone_and_voice || ''}
Hook & Audience: ${char.hook_and_audience || ''}
${occasionLine}${directionLine}

Respond with valid JSON only:
{
  "quote": "...",
  "context": "..."
}`;

  try {
    const response = await anthropicMessages({
      apiKey,
      model: db.getSetting('ai_model') || db.DEFAULTS.ai_model,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = response.content[0]?.text?.trim() || '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');
    const parsed = JSON.parse(match[0]);
    res.json({ quote: parsed.quote || '', context: parsed.context || '' });
  } catch (e) {
    console.error('Quote generation error:', e.message);
    res.status(500).json({ error: e.message });
  }
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

// ── Anthropic connectivity diagnostic ────────────────────────
app.get('/api/debug/anthropic-test', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY || db.getSetting('anthropic_api_key');
  const result = { apiKey: apiKey ? `${apiKey.slice(0, 10)}…` : 'NOT SET', steps: [] };
  if (!apiKey) return res.json(result);

  // Step 1: raw DNS/TCP — can we reach api.anthropic.com at all?
  try {
    const ping = await fetch('https://api.anthropic.com/', { method: 'HEAD' });
    result.steps.push({ step: 'reach api.anthropic.com', ok: true, status: ping.status });
  } catch (e) {
    result.steps.push({ step: 'reach api.anthropic.com', ok: false, error: e.message });
    return res.json(result);
  }

  // Step 2: raw fetch directly to Anthropic REST API (no SDK)
  try {
    const rawResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Say ok' }],
      }),
    });
    const rawData = await rawResp.json();
    result.steps.push({ step: 'raw fetch text call', ok: rawResp.ok, status: rawResp.status, reply: rawData?.content?.[0]?.text, error: rawData?.error?.message });
  } catch (e) {
    result.steps.push({ step: 'raw fetch text call', ok: false, error: `${e.constructor?.name}: ${e.message}` });
  }

  // Step 3: minimal text-only Anthropic SDK call
  try {
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'Say "ok"' }],
    });
    result.steps.push({ step: 'SDK text call', ok: true, reply: resp.content[0]?.text });
  } catch (e) {
    result.steps.push({ step: 'SDK text call', ok: false, error: `${e.constructor?.name}: ${e.message}`, status: e.status });
  }

  res.json(result);
});

// ── AI Generate — shared helper ───────────────────────────────
async function runAI({ req, res, fieldLabels, instructionPrefix }) {
  const apiKey = process.env.ANTHROPIC_API_KEY || db.getSetting('anthropic_api_key');
  if (!apiKey) return res.status(400).json({ error: 'Anthropic API key not configured.' });

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

  // Single uploaded file (drag-drop or file picker) — resize to keep payload small
  if (req.file) {
    const resizedFile = await sharp(req.file.buffer)
      .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
    userContent.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: resizedFile.toString('base64') } });
  }

  // Multiple product image URLs from the product picker (up to 5)
  // Resize each to ≤800px JPEG q70 before base64-encoding to keep the
  // total Anthropic API payload well under the 5MB limit.
  let productImageCount = 0;
  if (req.body.image_urls) {
    try {
      const urls = JSON.parse(req.body.image_urls);
      console.log(`[AI generate] image_urls received: ${urls.length} — ${JSON.stringify(urls.slice(0, 3))}`);
      for (const url of urls.slice(0, 5)) {
        // Safety check: only allow https:// URLs (prevents SSRF to localhost/internal)
        try { if (new URL(url).protocol !== 'https:') continue; } catch { continue; }
        try {
          const imgResp = await fetch(url);
          if (!imgResp.ok) { console.warn(`[AI generate] image fetch failed (${imgResp.status}): ${url}`); continue; }
          const rawBuf = Buffer.from(await imgResp.arrayBuffer());
          // Resize to max 800px and convert to JPEG to keep payload small
          const resized = await sharp(rawBuf)
            .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 70 })
            .toBuffer();
          const kb = Math.round(resized.length / 1024);
          console.log(`[AI generate] loaded product image ${productImageCount + 1}: ${kb}KB — ${url.slice(0, 80)}`);
          userContent.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: resized.toString('base64') } });
          productImageCount++;
        } catch (fetchErr) { console.warn(`[AI generate] image fetch/resize error for ${url}:`, fetchErr.message); }
      }
    } catch (e) { console.warn('[AI generate] image_urls parse error:', e.message); }
  } else {
    console.log('[AI generate] no image_urls in request body');
  }

  userContent.push({
    type: 'text',
    text: [
      productImageCount > 0 ? `You are given ${productImageCount} Lovepop product image${productImageCount > 1 ? 's' : ''} as visual reference. Synthesise a cohesive aesthetic from ${productImageCount > 1 ? 'all of them' : 'it'}.\n` : '',
      description ? `Description / notes:\n${description}\n` : '',
      `Generate a profile as a JSON object using EXACTLY these field names.`,
      `Every value must be a plain string — never an array or nested object.`,
      `Replace each <…> placeholder with the generated content:`,
      `{\n${schemaLines}\n}`,
      `\nRespond with valid JSON only — no markdown fences, no extra text.`,
    ].filter(Boolean).join('\n'),
  });

  try {
    const response = await anthropicMessages({
      apiKey,
      model: settings.ai_model || db.DEFAULTS.ai_model,
      max_tokens: 4096,
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
    hook_and_audience: 'My Hook & Audience',
  }})
);

// Land generation
app.post('/api/ai/generate-land', uploadMem.single('image'), (req, res) =>
  runAI({ req, res, instructionPrefix: 'ai_land_instruction_', fieldLabels: {
    name: 'Name', description: 'Description', visual_style: 'Visual Style',
    color_palette: 'Color Palette', themes_and_content: 'Themes & Content',
  }})
);

// ── Character Artwork Generator ───────────────────────────────
app.post('/api/ai/generate-char-image', uploadMem.array('images', 4), async (req, res) => {
  const openaiKey    = process.env.OPENAI_API_KEY    || db.getSetting('openai_api_key');
  const anthropicKey = process.env.ANTHROPIC_API_KEY || db.getSetting('anthropic_api_key');
  if (!openaiKey) return res.status(400).json({ error: 'OpenAI API key not configured. Add it in Settings to use image generation.' });

  const settings = db.getAllSettings();
  const { name = '', species = '', role = '', backstory = '', personality = '',
          key_passions = '', tone_and_voice = '', hook_and_audience = '', notes = '' } = req.body;

  // ── Step 1: Build the DALL-E prompt via Claude ────────────────
  let dallePrompt = '';

  if (anthropicKey) {
    const userContent = [];

    // Attach uploaded reference images (up to 4)
    if (req.files && req.files.length) {
      for (const file of req.files.slice(0, 4)) {
        userContent.push({ type: 'image', source: { type: 'base64', media_type: file.mimetype, data: file.buffer.toString('base64') } });
      }
    }

    userContent.push({
      type: 'text',
      text: [
        req.files && req.files.length
          ? `I've provided ${req.files.length} reference image${req.files.length > 1 ? 's' : ''} above. Use these to inform the character's visual appearance, art style, and aesthetic.\n`
          : '',
        `CHARACTER DATA:`,
        name        ? `Name: ${name}` : '',
        species     ? `Species/Type: ${species}` : '',
        role        ? `Role: ${role}` : '',
        backstory   ? `Backstory: ${backstory}` : '',
        personality ? `Personality: ${personality}` : '',
        key_passions ? `Key Passions: ${key_passions}` : '',
        tone_and_voice ? `Tone & Voice: ${tone_and_voice}` : '',
        hook_and_audience ? `Hook & Audience: ${hook_and_audience}` : '',
        notes       ? `\nAdditional artwork notes: ${notes}` : '',
        `\nWrite a single, detailed DALL-E 3 image generation prompt (120–200 words) for a piece of character artwork.`,
        `The artwork should feel like Lovepop's warm, whimsical, paper-art illustration style — expressive, charming, full of personality.`,
        `Be specific about the character's appearance, pose, expression, setting, color palette, lighting, and artistic medium.`,
        `Output ONLY the prompt text — no preamble, no markdown, no quotes.`,
      ].filter(Boolean).join('\n'),
    });

    try {
      const promptResp = await anthropicMessages({
        apiKey: anthropicKey,
        model: settings.ai_model || db.DEFAULTS.ai_model,
        max_tokens: 512,
        system: 'You write DALL-E 3 image generation prompts for character illustrations. Output only the raw prompt text.',
        messages: [{ role: 'user', content: userContent }],
      });
      dallePrompt = promptResp.content[0].text.trim();
    } catch (e) {
      console.warn('Claude prompt-building failed, using template:', e.message);
    }
  }

  // Fallback template prompt
  if (!dallePrompt) {
    dallePrompt = [
      `A charming, whimsical character illustration in the style of Lovepop paper art:`,
      name    ? `Character named "${name}"` : 'a Lovepop character',
      species ? `who is a ${species}` : '',
      role    ? `— ${role}` : '',
      personality ? `Personality: ${personality}` : '',
      notes   ? `Additional details: ${notes}` : '',
      `Warm, inviting illustration style. Expressive face, rich colors, soft lighting. Square composition.`,
    ].filter(Boolean).join('. ');
  }

  // ── Step 2: Call DALL-E 3 ─────────────────────────────────────
  try {
    const dalleResp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'dall-e-3',
        prompt: dallePrompt,
        size: '1024x1024',
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

    // Download & persist
    const imgResp = await fetch(imageUrl);
    if (!imgResp.ok) throw new Error('Failed to download generated image');
    const imgBuf  = Buffer.from(await imgResp.arrayBuffer());
    const filename = `char-art-${Date.now()}-${Math.random().toString(36).slice(2)}.png`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), imgBuf);

    res.json({ image_url: `/uploads/${filename}`, dalle_prompt: dallePrompt });
  } catch (err) {
    console.error('Character artwork generation error:', err);
    res.status(500).json({ error: err.message || 'Image generation failed' });
  }
});

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
      const promptResp = await anthropicMessages({
        apiKey: anthropicKey,
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

    // Populate sales cache from merch tool revenue data (revenue: { t12m, units })
    try {
      const salesRows = _productCache
        .filter(p => p.revenue && (p.revenue.t12m || p.revenue.units))
        .map(p => ({
          sku: p.sku,
          t12m_revenue: p.revenue.t12m || 0,
          t12m_units:   p.revenue.units || 0,
          asp: p.revenue.t12m && p.revenue.units ? p.revenue.t12m / p.revenue.units : 0,
        }));
      if (salesRows.length) {
        db.upsertSalesCache(salesRows);
        console.log(`[products] populated sales cache with ${salesRows.length} SKUs from merch tool`);
      }
    } catch (e) { console.warn('[products] sales cache populate error:', e.message); }

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

// ── Snowflake Sales Data ──────────────────────────────────────
app.get('/api/sales', (req, res) => {
  try {
    res.json(db.getAllSales());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sales/status', (req, res) => {
  try {
    res.json(db.getSalesStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sales/refresh', async (req, res) => {
  try {
    const { refreshSalesCache } = require('./snowflake');
    const count = await refreshSalesCache();
    const status = db.getSalesStatus();
    res.json({ ok: true, count, ...status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sales/test', async (req, res) => {
  try {
    const { testConnection } = require('./snowflake');
    await testConnection();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

// Asset Library routes
app.use('/api/asset-library', assetLibraryRouter);

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
