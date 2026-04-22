const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const router = express.Router();
const db = require('../database');
const { anthropicMessages } = require('../utils/anthropic');

const DATA_DIR = process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : null;
const UPLOADS_DIR = DATA_DIR
  ? path.join(DATA_DIR, 'uploads')
  : path.join(__dirname, '..', 'public', 'uploads');

// ── Gemini helper ─────────────────────────────────────────────
async function geminiGenerateImage(apiKey, model, prompt, refParts = []) {
  const parts = [...refParts, { text: prompt }];
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
      }),
    }
  );
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gemini API error ${resp.status}`);
  }
  const data = await resp.json();
  const responseParts = data.candidates?.[0]?.content?.parts || [];
  const imgPart = responseParts.find(p => p.inlineData);
  if (!imgPart) throw new Error('Gemini returned no image. Check your API key and model access.');
  return imgPart.inlineData.data; // base64 PNG
}

function saveBase64Image(base64, prefix) {
  const buf = Buffer.from(base64, 'base64');
  const filename = `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.png`;
  fs.writeFileSync(path.join(UPLOADS_DIR, filename), buf);
  return `/uploads/${filename}`;
}

// Load reference images from uploads for a given list of /uploads/... paths
function loadRefParts(imagePaths) {
  const parts = [];
  for (const imgPath of imagePaths) {
    const filename = path.basename(imgPath);
    // Uploaded images may be directly in UPLOADS_DIR or in a subdir
    const candidates = [
      path.join(UPLOADS_DIR, filename),
      path.join(UPLOADS_DIR, 'image-samples', filename),
      path.join(UPLOADS_DIR, 'artstyle-samples', filename),
    ];
    const fullPath = candidates.find(p => fs.existsSync(p));
    if (!fullPath) continue;
    try {
      const buf = fs.readFileSync(fullPath);
      const ext = path.extname(fullPath).slice(1).toLowerCase();
      const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      parts.push({ inlineData: { mimeType, data: buf.toString('base64') } });
    } catch (e) {
      console.warn('[card-designer] ref image load error:', e.message);
    }
  }
  return parts;
}

// ── CRUD ──────────────────────────────────────────────────────
router.get('/designs', (req, res) => {
  try { res.json(db.getAllCardDesigns()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/designs', (req, res) => {
  try { res.status(201).json(db.createCardDesign(req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/designs/:id', (req, res) => {
  const d = db.getCardDesign(req.params.id);
  if (!d) return res.status(404).json({ error: 'Not found' });
  res.json(d);
});

router.put('/designs/:id', (req, res) => {
  try { res.json(db.updateCardDesign(req.params.id, req.body)); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

router.delete('/designs/:id', (req, res) => {
  try { db.deleteCardDesign(req.params.id); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Generate copy (3 Claude calls in parallel) ────────────────
router.post('/designs/:id/generate-copy', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY || db.getSetting('anthropic_api_key');
  if (!apiKey) return res.status(400).json({ error: 'Anthropic API key not configured.' });

  const design = db.getCardDesign(req.params.id);
  if (!design) return res.status(404).json({ error: 'Design not found' });

  const settings = db.getAllSettings();
  const { direction = '', feedback = null } = req.body;
  const product = design.product_data || {};

  const instructions = {
    cover:        settings.cd_copy_instruction_cover        || db.DEFAULTS.cd_copy_instruction_cover,
    inside_left:  settings.cd_copy_instruction_inside_left  || db.DEFAULTS.cd_copy_instruction_inside_left,
    inside_right: settings.cd_copy_instruction_inside_right || db.DEFAULTS.cd_copy_instruction_inside_right,
    sculpture:    settings.cd_copy_instruction_sculpture    || db.DEFAULTS.cd_copy_instruction_sculpture,
    back:         settings.cd_copy_instruction_back         || db.DEFAULTS.cd_copy_instruction_back,
  };

  const systemPrompt = `You are a copy writer for Lovepop, a premium pop-up greeting card company known for beautiful paper art and heartfelt messages. Generate warm, emotionally resonant, on-brand card copy. Respond with valid JSON only — no markdown, no extra text.`;

  const buildPrompt = () => {
    const lines = [
      `Generate card copy for this Lovepop product:`,
      `SKU: ${product.sku || '—'}`,
      `Name: ${product.name || '—'}`,
      `Occasion: ${Array.isArray(product.occasions) ? product.occasions.join(', ') : (product.occasion || '—')}`,
      product.description ? `Description: ${product.description}` : '',
      direction ? `\nDirection / notes: ${direction}` : '',
    ];

    if (feedback) {
      if (feedback.liked_examples?.length) {
        lines.push(`\nPositive examples to draw inspiration from (match this energy and quality):`);
        feedback.liked_examples.forEach((ex, i) => {
          lines.push(`  Example ${i + 1}: Cover: "${ex.cover}" | Inside Left: "${ex.inside_left}" | Inside Right: "${ex.inside_right}"`);
        });
      }
      if (feedback.disliked_notes?.filter(Boolean).length) {
        lines.push(`\nThings to avoid in this generation: ${feedback.disliked_notes.filter(Boolean).join('; ')}`);
      }
    }

    lines.push(
      `\nField instructions:`,
      `- Cover: ${instructions.cover}`,
      `- Inside Left: ${instructions.inside_left}`,
      `- Inside Right: ${instructions.inside_right}`,
      `- Sculpture: ${instructions.sculpture}`,
      `- Back of Card: ${instructions.back}`,
      `\nRespond with valid JSON only:\n{\n  "cover": "...",\n  "inside_left": "...",\n  "inside_right": "...",\n  "sculpture": "...",\n  "back": "..."\n}`,
    );

    return lines.filter(Boolean).join('\n');
  };

  const callClaude = async () => {
    const response = await anthropicMessages({
      apiKey,
      model: settings.ai_model || db.DEFAULTS.ai_model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: buildPrompt() }],
    });
    const raw = response.content[0].text.trim();
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in Claude response');
    const parsed = JSON.parse(match[0]);
    return {
      cover:        parsed.cover        || '',
      inside_left:  parsed.inside_left  || '',
      inside_right: parsed.inside_right || '',
      sculpture:    parsed.sculpture    || '',
      back:         parsed.back         || '',
    };
  };

  try {
    const options = await Promise.all([callClaude(), callClaude(), callClaude()]);
    res.json({ options });
  } catch (e) {
    console.error('[card-designer] generate-copy error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Generate concept sketch (3 Gemini calls in parallel) ──────
router.post('/designs/:id/generate-sketch', async (req, res) => {
  const geminiKey = process.env.GEMINI_API_KEY || db.getSetting('gemini_api_key');
  if (!geminiKey) return res.status(400).json({ error: 'Gemini API key not configured. Add it in Settings → Card Designer.' });

  const design = db.getCardDesign(req.params.id);
  if (!design) return res.status(404).json({ error: 'Design not found' });

  const settings = db.getAllSettings();
  const model = settings.gemini_model || db.DEFAULTS.gemini_model;
  const { direction = '', feedback = null } = req.body;
  const product = design.product_data || {};
  const copy = design.selected_copy || {};

  const baseInstructions = settings.cd_sketch_system_prompt || db.DEFAULTS.cd_sketch_system_prompt;

  const buildPrompt = () => {
    const lines = [
      baseInstructions,
      `\nPRODUCT: ${product.name || 'Lovepop Card'}`,
      `OCCASION: ${Array.isArray(product.occasions) ? product.occasions.join(', ') : (product.occasion || 'General')}`,
      copy.cover        ? `COVER COPY: "${copy.cover}"` : '',
      copy.inside_left  ? `INSIDE COPY: "${copy.inside_left}"` : '',
      copy.sculpture    ? `SCULPTURE COPY: "${copy.sculpture}"` : '',
      direction         ? `\nDirection / notes: ${direction}` : '',
    ];
    if (feedback?.disliked_notes?.filter(Boolean).length) {
      lines.push(`\nAvoid: ${feedback.disliked_notes.filter(Boolean).join('; ')}`);
    }
    return lines.filter(Boolean).join('\n');
  };

  const generateOne = async () => {
    const base64 = await geminiGenerateImage(geminiKey, model, buildPrompt());
    return saveBase64Image(base64, 'cd-sketch');
  };

  try {
    const urls = await Promise.all([generateOne(), generateOne(), generateOne()]);
    res.json({ urls });
  } catch (e) {
    console.error('[card-designer] generate-sketch error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Generate detailed concept (3 Gemini calls in parallel) ────
router.post('/designs/:id/generate-concept', async (req, res) => {
  const geminiKey = process.env.GEMINI_API_KEY || db.getSetting('gemini_api_key');
  if (!geminiKey) return res.status(400).json({ error: 'Gemini API key not configured. Add it in Settings → Card Designer.' });

  const design = db.getCardDesign(req.params.id);
  if (!design) return res.status(404).json({ error: 'Design not found' });

  const settings = db.getAllSettings();
  const model = settings.gemini_model || db.DEFAULTS.gemini_model;
  const { direction = '', character_id = '', art_style_id = '', feedback = null } = req.body;
  const product = design.product_data || {};
  const copy = design.selected_copy || {};

  const character = character_id ? db.getCharacter(character_id) : null;
  const artStyle  = art_style_id  ? db.getArtStyle(art_style_id)  : null;

  const buildPrompt = () => {
    const lines = [
      `Create a detailed product illustration for a Lovepop pop-up greeting card.`,
      `PRODUCT: ${product.name || 'Lovepop Card'}`,
      `OCCASION: ${Array.isArray(product.occasions) ? product.occasions.join(', ') : (product.occasion || 'General')}`,
      copy.cover       ? `COVER COPY: "${copy.cover}"` : '',
      copy.inside_left ? `INSIDE COPY: "${copy.inside_left}"` : '',
      copy.sculpture   ? `SCULPTURE COPY: "${copy.sculpture}"` : '',
    ];

    if (character) {
      lines.push(`\nFEATURED CHARACTER: ${character.name}`);
      if (character.species)     lines.push(`Species: ${character.species}`);
      if (character.personality) lines.push(`Personality: ${character.personality}`);
      if (character.backstory)   lines.push(`Backstory: ${character.backstory}`);
    }

    if (artStyle) {
      lines.push(`\nART STYLE: ${artStyle.name}`);
      if (artStyle.description)            lines.push(`Style: ${artStyle.description}`);
      if (artStyle.visual_technique)       lines.push(`Technique: ${artStyle.visual_technique}`);
      if (artStyle.color_palette)          lines.push(`Colors: ${artStyle.color_palette}`);
      if (artStyle.characteristic_elements) lines.push(`Elements: ${artStyle.characteristic_elements}`);
    }

    if (direction) lines.push(`\nDirection / notes: ${direction}`);

    if (feedback?.liked_urls?.length) {
      lines.push(`\nBuild on the visual direction established — fresh composition but consistent aesthetic.`);
    }
    if (feedback?.disliked_notes?.filter(Boolean).length) {
      lines.push(`\nAvoid: ${feedback.disliked_notes.filter(Boolean).join('; ')}`);
    }

    lines.push(
      `\nCreate a polished product illustration showing:`,
      `1. Card cover with beautiful artwork`,
      `2. Inside spread with the 3D pop-up sculpture`,
      `Lovepop's signature warm, intricate, paper-art aesthetic. Full color, detailed, beautiful.`,
    );

    return lines.filter(Boolean).join('\n');
  };

  const buildRefParts = () => {
    const imagePaths = [];
    if (character?.images?.length) imagePaths.push(...character.images.slice(0, 2));
    if (artStyle?.images?.length)  imagePaths.push(...artStyle.images.slice(0, 2));
    return loadRefParts(imagePaths);
  };

  const generateOne = async () => {
    const refParts = buildRefParts();
    const base64 = await geminiGenerateImage(geminiKey, model, buildPrompt(), refParts);
    return saveBase64Image(base64, 'cd-concept');
  };

  try {
    const urls = await Promise.all([generateOne(), generateOne(), generateOne()]);
    res.json({ urls });
  } catch (e) {
    console.error('[card-designer] generate-concept error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
