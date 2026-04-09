const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Uploads dir
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Multer — persistent storage for character images, memory for AI temp uploads
const diskStorage = multer.diskStorage({
  destination: UPLOADS_DIR,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const memStorage = multer.memoryStorage();

const uploadDisk = multer({ storage: diskStorage, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadMem  = multer({ storage: memStorage,  limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Characters API ────────────────────────────────────────────
app.get('/api/characters', (req, res) => res.json(db.getAllCharacters()));

app.get('/api/characters/:id', (req, res) => {
  const char = db.getCharacter(req.params.id);
  if (!char) return res.status(404).json({ error: 'Not found' });
  res.json(char);
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
  const url = `/uploads/${req.file.filename}`;
  const updated = db.updateCharacter(req.params.id, { images: [...char.images, url] });
  res.json(updated);
});

// ── Settings API ──────────────────────────────────────────────
app.get('/api/settings', (req, res) => {
  const settings = db.getAllSettings();
  // Never expose API key to client — just whether it's set
  const apiKeySet = !!(process.env.ANTHROPIC_API_KEY || settings.anthropic_api_key);
  res.json({ ...settings, anthropic_api_key: undefined, api_key_configured: apiKeySet });
});

app.put('/api/settings', (req, res) => {
  // Allow saving anthropic_api_key from client (stored in DB)
  db.setSettings(req.body);
  res.json({ success: true });
});

app.get('/api/settings/api-key-status', (req, res) => {
  const envKey = process.env.ANTHROPIC_API_KEY;
  const dbKey  = db.getSetting('anthropic_api_key');
  res.json({ configured: !!(envKey || dbKey), source: envKey ? 'env' : dbKey ? 'db' : 'none' });
});

// ── AI Generate API ───────────────────────────────────────────
app.post('/api/ai/generate', uploadMem.single('image'), async (req, res) => {
  // Get API key: env var takes priority, fall back to DB
  const apiKey = process.env.ANTHROPIC_API_KEY || db.getSetting('anthropic_api_key');
  if (!apiKey) {
    return res.status(400).json({ error: 'Anthropic API key not configured. Add ANTHROPIC_API_KEY to your environment variables or save it in Settings.' });
  }

  const anthropic = new Anthropic({ apiKey });
  const settings = db.getAllSettings();
  const { description = '' } = req.body;

  // Build field instructions block
  const FIELD_LABELS = {
    name:               'Name',
    species:            'Species',
    role:               'Role',
    backstory:          'Backstory',
    personality:        'Personality',
    key_passions:       'Key Passions',
    what_they_care_about: 'What They Care About',
    tone_and_voice:     'Tone & Voice',
  };

  const fieldBlock = Object.entries(FIELD_LABELS).map(([key, label]) => {
    const instruction = settings[`ai_instruction_${key}`] || db.DEFAULTS[`ai_instruction_${key}`] || '';
    return `"${key}": ${instruction}`;
  }).join('\n');

  // Build user message content
  const userContent = [];

  if (req.file) {
    userContent.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: req.file.mimetype,
        data: req.file.buffer.toString('base64'),
      },
    });
  }

  userContent.push({
    type: 'text',
    text: [
      description ? `Character description / notes:\n${description}\n` : '',
      `Generate a Lovepop character profile as a JSON object with exactly these fields and follow these instructions for each:`,
      fieldBlock,
      `\nRespond with valid JSON only. No markdown code blocks, no extra text — just the raw JSON object.`,
    ].filter(Boolean).join('\n'),
  });

  try {
    const model = settings.ai_model || db.DEFAULTS.ai_model;
    const systemPrompt = settings.ai_system_prompt || db.DEFAULTS.ai_system_prompt;

    const response = await anthropic.messages.create({
      model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    });

    const rawText = response.content[0].text.trim();

    // Extract JSON (in case model wraps it)
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found in response');

    const generated = JSON.parse(jsonMatch[0]);
    res.json(generated);
  } catch (err) {
    console.error('AI generation error:', err);
    res.status(500).json({ error: err.message || 'AI generation failed' });
  }
});

// Diagnostic — shows where the DB is being stored
app.get('/api/debug/db-path', (req, res) => {
  const dbPath = process.env.DB_PATH || path.join(__dirname, 'characters.db');
  res.json({
    db_path: dbPath,
    db_path_source: process.env.DB_PATH ? 'env var (good — persistent)' : 'local filesystem (bad — will be wiped on redeploy)',
    exists: fs.existsSync(dbPath),
    env_DB_PATH: process.env.DB_PATH || '(not set)',
  });
});

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Lovepop Character Builder → http://localhost:${PORT}`));
