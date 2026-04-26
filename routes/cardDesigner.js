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
async function geminiGenerateImage(apiKey, model, prompt, refParts = [], aspectRatio = null) {
  const parts = [...refParts, { text: prompt }];
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'], ...(aspectRatio ? { aspectRatio } : {}) },
      }),
    }
  );
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => '');
    let errMsg = `Gemini API error ${resp.status}`;
    try { const j = JSON.parse(errBody); errMsg = j.error?.message || errMsg; } catch {}
    console.error('[gemini] API error', resp.status, errMsg, errBody.slice(0, 300));
    throw new Error(errMsg);
  }
  const data = await resp.json();
  const responseParts = data.candidates?.[0]?.content?.parts || [];
  const imgPart = responseParts.find(p => p.inlineData);
  if (!imgPart) {
    const finishReason = data.candidates?.[0]?.finishReason || 'UNKNOWN';
    throw new Error(`Gemini returned no image (finishReason: ${finishReason}). Check API key, model access, and content filters.`);
  }
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
      path.join(UPLOADS_DIR, 'cover-sketch-samples', filename),
      path.join(UPLOADS_DIR, 'sketch-template', filename),
      path.join(UPLOADS_DIR, 'cover-sketch-template', filename),
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
  try {
    const { status, q } = req.query;
    let list = db.getAllCardDesigns();
    if (status) list = list.filter(d => d.status === status);
    if (q) {
      const lq = q.toLowerCase();
      list = list.filter(d =>
        (d.name || '').toLowerCase().includes(lq) ||
        (d.sku  || '').toLowerCase().includes(lq)
      );
    }
    const charMap  = db.getCharacterNamesMap();
    const styleMap = db.getArtStyleNamesMap();
    const enriched = list.map(d => {
      const hasCopy        = !!(d.is_blank_card || (d.selected_copy && (d.selected_copy.cover || d.selected_copy.inside_left)));
      const hasInsideSketch = !!d.selected_sketch_url;
      const hasCoverSketch  = !!d.selected_cover_sketch_url;
      const hasConcept      = !!d.selected_concept_url;
      return {
        ...d,
        character_name: d.character_id ? (charMap[String(d.character_id)] || '') : '',
        art_style_name: d.art_style_id  ? (styleMap[String(d.art_style_id)]  || '') : '',
        progress: [
          hasCopy         ? 'done' : (d.copy_rounds?.length          ? 'active' : 'empty'),
          hasInsideSketch ? 'done' : (d.sketch_rounds?.length        ? 'active' : 'empty'),
          hasCoverSketch  ? 'done' : (d.cover_sketch_rounds?.length  ? 'active' : 'empty'),
          hasConcept      ? 'done' : (d.concept_rounds?.length       ? 'active' : 'empty'),
        ],
        rounds_count: (d.copy_rounds?.length || 0) + (d.sketch_rounds?.length || 0) + (d.cover_sketch_rounds?.length || 0) + (d.concept_rounds?.length || 0),
      };
    });
    res.json(enriched);
  } catch (e) { res.status(500).json({ error: e.message }); }
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

router.patch('/designs/:id', (req, res) => {
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
  const { direction = '', feedback = null, count = 3 } = req.body;
  const product = design.product_data || {};
  const productTitle = design.product_title || product.name || product.sku || '';

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
      productTitle ? `Product: ${productTitle}` : '',
      product.sku ? `SKU: ${product.sku}` : '',
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
      // support both old key (disliked_notes) and new key (direction_notes)
      const dirNotes = feedback.direction_notes || feedback.disliked_notes;
      if (dirNotes?.filter(Boolean).length) {
        lines.push(`\nComments / direction from previous rounds: ${dirNotes.filter(Boolean).join('; ')}`);
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
    const n = Math.min(Math.max(1, parseInt(count, 10) || 3), 9);
    const options = await Promise.all(Array.from({ length: n }, () => callClaude()));

    // Persist as a new copy round
    const newRound = {
      id: crypto.randomBytes(8).toString('hex'),
      index: (design.copy_rounds?.length || 0) + 1,
      created_at: new Date().toISOString(),
      refine_note: direction || '',
      cards: options.map(opt => ({
        id: crypto.randomBytes(8).toString('hex'),
        ...opt,
        vote: null,
        note: '',
      })),
    };
    const updatedRounds = [...(design.copy_rounds || []), newRound];
    const updated = db.updateCardDesign(req.params.id, { copy_rounds: updatedRounds });
    res.json({ round: newRound, design: updated });
  } catch (e) {
    console.error('[card-designer] generate-copy error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Sketch round (new round-based system) ─────────────────────
router.post('/designs/:id/sketch/round', async (req, res) => {
  const geminiKey = process.env.GEMINI_API_KEY || db.getSetting('gemini_api_key');
  if (!geminiKey) return res.status(400).json({ error: 'Gemini API key not configured. Add it in Settings → Card Designer.' });

  const design = db.getCardDesign(req.params.id);
  if (!design) return res.status(404).json({ error: 'Design not found' });

  const settings = db.getAllSettings();
  const model    = settings.gemini_model || db.DEFAULTS.gemini_model;
  const { refine_note = '', fidelity = 'standard', count = 3, parent_card_id = null } = req.body;

  const product = design.product_data || {};
  const copy    = design.selected_copy || {};
  const productTitle  = design.product_title || product.name || '';
  const basePrompt    = settings.cd_sketch_system_prompt_base || settings.cd_sketch_system_prompt || db.DEFAULTS.cd_sketch_system_prompt_base || db.DEFAULTS.cd_sketch_system_prompt || '';
  const fidelityPart  = settings[`cd_sketch_fidelity_${fidelity}`] || db.DEFAULTS[`cd_sketch_fidelity_${fidelity}`] || '';
  // Sketch template — the form/page AI draws onto (single global image)
  const sketchTemplatePath = settings.cd_sketch_template || null;

  // Sketch sample images — from uploaded files (stored as JSON array in cd_sketch_samples)
  const sampleImages = (() => {
    try { return JSON.parse(settings.cd_sketch_samples || '[]'); } catch { return []; }
  })();

  // Load per-design sculpture reference image (uploaded by user in sketch sidebar)
  const sculptureRefPart = (() => {
    if (!design.sketch_ref_image) return null;
    const filename = path.basename(design.sketch_ref_image);
    const fullPath = path.join(UPLOADS_DIR, 'sketch-refs', filename);
    if (!fs.existsSync(fullPath)) return null;
    try {
      const buf = fs.readFileSync(fullPath);
      const ext = path.extname(fullPath).slice(1).toLowerCase();
      const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      return { inlineData: { mimeType, data: buf.toString('base64') } };
    } catch (e) { console.warn('[sketch] sculpture ref load error:', e.message); return null; }
  })();

  const buildPrompt = () => {
    const lines = [
      basePrompt,
      fidelityPart ? `\n${fidelityPart}` : '',
      `\nPRODUCT: ${productTitle || 'Lovepop Card'}`,
      `OCCASION: ${Array.isArray(product.occasions) ? product.occasions.join(', ') : (product.occasion || 'General')}`,
      copy.cover       ? `COVER COPY: "${copy.cover}"` : '',
      copy.inside_left ? `INSIDE COPY: "${copy.inside_left}"` : '',
      copy.sculpture   ? `SCULPTURE COPY: "${copy.sculpture}"` : '',
      sculptureRefPart ? `\n3D SCULPTURE REFERENCE: A photo of an existing 3D paper sculpture is provided as a visual reference. Use it to inform the engineering style, layering approach, and dimensional quality — adapt creatively, do not replicate exactly.` : '',
      sketchTemplatePath ? `\nTEMPLATE FILE: A blank architectural/engineering template file is provided as the first image. Draw your sketch directly onto this template — use its grid, fold lines, and layout as the structural foundation for your design.` : '',
      parent_card_id ? `\nITERATION MODE: You are provided a reference sketch to build directly from. Evolve and refine it based on the refinement direction below. Keep the overall composition and engineering approach, making the requested improvements.` : '',
      refine_note ? `\nRefinement direction: ${refine_note}` : '',
      sampleImages.length > 0 ? `\nStyle reference sketches provided (${sampleImages.length} sample image${sampleImages.length > 1 ? 's' : ''}).` : '',
    ];

    const prevRounds = design.sketch_rounds || [];
    if (prevRounds.length > 0) {
      const labelLines = [];
      prevRounds.forEach((r, ri) => {
        (r.cards || []).forEach((c, ci) => {
          const label = `${ri+1}${String.fromCharCode(65+ci)}`;
          if (c.note) labelLines.push(`  ${label}: "${c.note}"`);
        });
      });
      if (labelLines.length) lines.push(`\nSketch notes by label (reference by label to combine elements):\n${labelLines.join('\n')}`);
      const dislikedNotes = prevRounds.flatMap(r => r.cards.filter(c => c.vote === 'disliked' && c.note).map(c => c.note));
      if (dislikedNotes.length) lines.push(`\nAvoid: ${dislikedNotes.join('; ')}`);
    }

    return lines.filter(Boolean).join('\n');
  };

  // Build Gemini image parts
  const sketchRefParts = (() => {
    const parts = [];

    // 0. Template file — always first so AI draws onto it
    if (sketchTemplatePath) {
      const templateFullPath = path.join(UPLOADS_DIR, 'sketch-template', path.basename(sketchTemplatePath));
      if (fs.existsSync(templateFullPath)) {
        try {
          const buf = fs.readFileSync(templateFullPath);
          const ext = path.extname(templateFullPath).slice(1).toLowerCase();
          const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
          parts.push({ inlineData: { mimeType, data: buf.toString('base64') } });
        } catch (e) { console.warn('[sketch] template load error:', e.message); }
      }
    }

    // 1. Per-design sculpture reference photo
    if (sculptureRefPart) parts.push(sculptureRefPart);

    const loadImg = (fullPath) => {
      if (!fs.existsSync(fullPath)) return null;
      try {
        const buf = fs.readFileSync(fullPath);
        const ext = path.extname(fullPath).slice(1).toLowerCase();
        const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        return { inlineData: { mimeType, data: buf.toString('base64') } };
      } catch { return null; }
    };

    if (parent_card_id) {
      // 2a. Iterate mode: use ONLY the specific parent card's image as seed
      const allRounds = design.sketch_rounds || [];
      let parentCard = null;
      for (const r of allRounds) {
        parentCard = (r.cards || []).find(c => c.id === parent_card_id);
        if (parentCard) break;
      }
      if (parentCard?.url) {
        const part = loadImg(path.join(UPLOADS_DIR, path.basename(parentCard.url)));
        if (part) parts.push(part);
      }
    } else {
      // 2b. Fresh round: use last 2 rounds' images as combination reference (max 6)
      const allRounds = design.sketch_rounds || [];
      const recentRounds = allRounds.slice(-2);
      for (const round of recentRounds) {
        for (const card of (round.cards || [])) {
          if (!card.url) continue;
          const part = loadImg(path.join(UPLOADS_DIR, path.basename(card.url)));
          if (part) parts.push(part);
        }
      }
    }

    // 3. Global sketch style samples (max 2)
    for (const imgPath of sampleImages.slice(0, 2)) {
      const filename = path.basename(imgPath);
      const part = loadImg(path.join(UPLOADS_DIR, 'sketch-samples', filename));
      if (part) parts.push(part);
    }
    return parts;
  })();

  const generateOne = async () => {
    const base64 = await geminiGenerateImage(geminiKey, model, buildPrompt(), sketchRefParts);
    return saveBase64Image(base64, 'cd-sketch');
  };

  try {
    const n = Math.min(Math.max(1, parseInt(count, 10) || 3), 9);
    const urls = await Promise.all(Array.from({ length: n }, () => generateOne()));
    const newRound = {
      id: crypto.randomBytes(8).toString('hex'),
      index: (design.sketch_rounds?.length || 0) + 1,
      created_at: new Date().toISOString(),
      refine_note,
      fidelity,
      parent_card_id: parent_card_id || null,
      cards: urls.map(url => ({ id: crypto.randomBytes(8).toString('hex'), url, vote: null, note: '' })),
    };
    const updatedRounds = [...(design.sketch_rounds || []), newRound];
    const updated = db.updateCardDesign(req.params.id, { sketch_rounds: updatedRounds });
    res.json({ round: newRound, design: updated });
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)) || 'Unknown error in sketch generation';
    console.error('[sketch/round] error:', msg, e?.stack || '');
    res.status(500).json({ error: msg });
  }
});

// ── Update sketch card vote/note ───────────────────────────────
router.patch('/designs/:id/sketch/card/:cardId', (req, res) => {
  try {
    const design = db.getCardDesign(req.params.id);
    if (!design) return res.status(404).json({ error: 'Design not found' });
    const { vote, note } = req.body;
    const updatedRounds = (design.sketch_rounds || []).map(round => ({
      ...round,
      cards: round.cards.map(card =>
        card.id === req.params.cardId
          ? { ...card, ...(vote !== undefined ? { vote } : {}), ...(note !== undefined ? { note } : {}) }
          : card
      ),
    }));
    const updated = db.updateCardDesign(req.params.id, { sketch_rounds: updatedRounds });
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Promote sketch to concept ──────────────────────────────────
router.post('/designs/:id/promote-sketch', (req, res) => {
  try {
    const design = db.getCardDesign(req.params.id);
    if (!design) return res.status(404).json({ error: 'Design not found' });
    const { card_id } = req.body;
    let selectedUrl = null;
    for (const round of design.sketch_rounds || []) {
      const card = round.cards.find(c => c.id === card_id);
      if (card) { selectedUrl = card.url; break; }
    }
    if (!selectedUrl) return res.status(404).json({ error: 'Card not found in sketch rounds' });
    const updated = db.updateCardDesign(req.params.id, { selected_sketch_url: selectedUrl, active_module: 'concept' });
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Cover sketch round ─────────────────────────────────────────
router.post('/designs/:id/cover-sketch/round', async (req, res) => {
  const geminiKey = process.env.GEMINI_API_KEY || db.getSetting('gemini_api_key');
  if (!geminiKey) return res.status(400).json({ error: 'Gemini API key not configured. Add it in Settings → Card Designer.' });

  const design = db.getCardDesign(req.params.id);
  if (!design) return res.status(404).json({ error: 'Design not found' });

  const settings = db.getAllSettings();
  const model    = settings.gemini_model || db.DEFAULTS.gemini_model;
  const { refine_note = '', fidelity = 'standard', count = 3, parent_card_id = null } = req.body;

  const product       = design.product_data || {};
  const copy          = design.selected_copy || {};
  const productTitle  = design.product_title || product.name || '';
  const basePrompt    = settings.cd_cover_sketch_system_prompt_base || settings.cd_cover_sketch_system_prompt || db.DEFAULTS.cd_cover_sketch_system_prompt_base || db.DEFAULTS.cd_cover_sketch_system_prompt || '';
  const fidelityPart  = settings[`cd_sketch_fidelity_${fidelity}`] || db.DEFAULTS[`cd_sketch_fidelity_${fidelity}`] || '';

  const sampleImages = (() => {
    try { return JSON.parse(settings.cd_cover_sketch_samples || '[]'); } catch { return []; }
  })();

  // Cover style reference
  const coverStyleId = design.selected_cover_style_id || null;
  const coverStyleData = coverStyleId ? db.getCoverStyle(coverStyleId) : null;

  // Per-design cover reference photo
  const coverRefPart = (() => {
    if (!design.cover_ref_image) return null;
    const filename = path.basename(design.cover_ref_image);
    const fullPath = path.join(UPLOADS_DIR, 'cover-refs', filename);
    if (!fs.existsSync(fullPath)) return null;
    try {
      const buf = fs.readFileSync(fullPath);
      const ext = path.extname(fullPath).slice(1).toLowerCase();
      const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      return { inlineData: { mimeType, data: buf.toString('base64') } };
    } catch (e) { console.warn('[cover-sketch] cover ref load error:', e.message); return null; }
  })();

  const buildPrompt = () => {
    const lines = [
      basePrompt,
      fidelityPart ? `\n${fidelityPart}` : '',
      `\nPRODUCT: ${productTitle || 'Lovepop Card'}`,
      `OCCASION: ${Array.isArray(product.occasions) ? product.occasions.join(', ') : (product.occasion || 'General')}`,
      copy.cover ? `COVER COPY: "${copy.cover}"` : '',
      coverRefPart ? `\nCOVER REFERENCE: A reference image for the cover layout/style is provided. Use it to inform the composition and aesthetic — adapt creatively, do not replicate exactly.` : '',
      coverStyleData ? `\nCOVER STYLE REFERENCE — "${coverStyleData.name}": ${coverStyleData.description || ''}` : '',
      coverStyleData ? `IMPORTANT: The cover style reference images provided are for LAYOUT REFERENCE ONLY. Study the graphic composition, element arrangement, visual hierarchy, border/frame usage, typography placement, and white-space strategy. Do NOT reproduce the illustration subject matter, themes, color palette, or specific graphical content from these references. Apply only the structural and compositional logic.` : '',
      coverStyleData?.layout_approach ? `Layout approach: ${coverStyleData.layout_approach}` : '',
      coverStyleData?.color_scheme ? `Color scheme strategy: ${coverStyleData.color_scheme}` : '',
      coverStyleData?.graphic_elements ? `Graphic elements: ${coverStyleData.graphic_elements}` : '',
      coverStyleData?.composition_notes ? `Composition: ${coverStyleData.composition_notes}` : '',
      coverStyleData?.typography_treatment ? `Typography treatment: ${coverStyleData.typography_treatment}` : '',
      parent_card_id ? `\nITERATION MODE: You are provided a reference sketch to build directly from. Evolve and refine it based on the refinement direction below. Keep the overall composition and engineering approach, making the requested improvements.` : '',
      refine_note ? `\nRefinement direction: ${refine_note}` : '',
      sampleImages.length > 0 ? `\nStyle reference images provided (${sampleImages.length} sample image${sampleImages.length > 1 ? 's' : ''}).` : '',
    ];

    const prevRounds = design.cover_sketch_rounds || [];
    if (prevRounds.length > 0) {
      const labelLines = [];
      prevRounds.forEach((r, ri) => {
        (r.cards || []).forEach((c, ci) => {
          const label = `${ri+1}${String.fromCharCode(65+ci)}`;
          if (c.note) labelLines.push(`  ${label}: "${c.note}"`);
        });
      });
      if (labelLines.length) lines.push(`\nCover sketch notes by label (reference by label to combine elements):\n${labelLines.join('\n')}`);
    }

    return lines.filter(Boolean).join('\n');
  };

  // Build ref parts: [cover ref, ...parent card or recent round images, ...sample images, ...cover style images]
  const refParts = (() => {
    const parts = [];

    if (coverRefPart) parts.push(coverRefPart);

    const loadImg = (fullPath) => {
      if (!fs.existsSync(fullPath)) return null;
      try {
        const buf = fs.readFileSync(fullPath);
        const ext = path.extname(fullPath).slice(1).toLowerCase();
        const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
        return { inlineData: { mimeType, data: buf.toString('base64') } };
      } catch { return null; }
    };

    if (parent_card_id) {
      // Iterate mode: use ONLY the specific parent card's image as seed
      const allRounds = design.cover_sketch_rounds || [];
      let parentCard = null;
      for (const r of allRounds) {
        parentCard = (r.cards || []).find(c => c.id === parent_card_id);
        if (parentCard) break;
      }
      if (parentCard?.url) {
        const part = loadImg(path.join(UPLOADS_DIR, path.basename(parentCard.url)));
        if (part) parts.push(part);
      }
    } else {
      // Fresh round: use last 2 rounds' images as combination reference
      const recentRounds = (design.cover_sketch_rounds || []).slice(-2);
      for (const round of recentRounds) {
        for (const card of (round.cards || [])) {
          if (!card.url) continue;
          const part = loadImg(path.join(UPLOADS_DIR, path.basename(card.url)));
          if (part) parts.push(part);
        }
      }
    }

    for (const imgPath of sampleImages.slice(0, 2)) {
      const filename = path.basename(imgPath);
      const part = loadImg(path.join(UPLOADS_DIR, 'cover-sketch-samples', filename));
      if (part) parts.push(part);
    }

    // Cover style reference images — all available (layout reference only, instruction in prompt)
    if (coverStyleData?.images?.length) {
      for (const imgPath of coverStyleData.images) {
        const part = loadImg(path.join(UPLOADS_DIR, path.basename(imgPath)));
        if (part) parts.push(part);
      }
    }

    return parts;
  })();

  const generateOne = async () => {
    const base64 = await geminiGenerateImage(geminiKey, model, buildPrompt(), refParts, '5:7');
    return saveBase64Image(base64, 'cd-cover-sketch');
  };

  try {
    const n = Math.min(Math.max(1, parseInt(count, 10) || 3), 9);
    const urls = await Promise.all(Array.from({ length: n }, () => generateOne()));
    const newRound = {
      id: crypto.randomBytes(8).toString('hex'),
      index: (design.cover_sketch_rounds?.length || 0) + 1,
      created_at: new Date().toISOString(),
      refine_note,
      fidelity,
      cards: urls.map(url => ({ id: crypto.randomBytes(8).toString('hex'), url, vote: null, note: '' })),
    };
    const updatedRounds = [...(design.cover_sketch_rounds || []), newRound];
    const updated = db.updateCardDesign(req.params.id, { cover_sketch_rounds: updatedRounds });
    res.json({ round: newRound, design: updated });
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)) || 'Unknown error in cover sketch generation';
    console.error('[cover-sketch/round] error:', msg, e?.stack || '');
    res.status(500).json({ error: msg });
  }
});

// ── Update cover sketch card vote/note ─────────────────────────
router.patch('/designs/:id/cover-sketch/card/:cardId', (req, res) => {
  try {
    const design = db.getCardDesign(req.params.id);
    if (!design) return res.status(404).json({ error: 'Design not found' });
    const { vote, note } = req.body;
    const updatedRounds = (design.cover_sketch_rounds || []).map(round => ({
      ...round,
      cards: round.cards.map(card =>
        card.id === req.params.cardId
          ? { ...card, ...(vote !== undefined ? { vote } : {}), ...(note !== undefined ? { note } : {}) }
          : card
      ),
    }));
    const updated = db.updateCardDesign(req.params.id, { cover_sketch_rounds: updatedRounds });
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Promote cover sketch ───────────────────────────────────────
router.post('/designs/:id/promote-cover-sketch', (req, res) => {
  try {
    const design = db.getCardDesign(req.params.id);
    if (!design) return res.status(404).json({ error: 'Design not found' });
    const { card_id } = req.body;
    let selectedUrl = null;
    for (const round of design.cover_sketch_rounds || []) {
      const card = round.cards.find(c => c.id === card_id);
      if (card) { selectedUrl = card.url; break; }
    }
    if (!selectedUrl) return res.status(404).json({ error: 'Card not found in cover sketch rounds' });
    const updated = db.updateCardDesign(req.params.id, { selected_cover_sketch_url: selectedUrl });
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
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

// ── Generate detailed concept (round-based) ───────────────────
router.post('/designs/:id/generate-concept', async (req, res) => {
  const geminiKey = process.env.GEMINI_API_KEY || db.getSetting('gemini_api_key');
  if (!geminiKey) return res.status(400).json({ error: 'Gemini API key not configured. Add it in Settings → Card Designer.' });

  const design = db.getCardDesign(req.params.id);
  if (!design) return res.status(404).json({ error: 'Design not found' });

  const settings = db.getAllSettings();
  const model = settings.gemini_model || db.DEFAULTS.gemini_model;
  const { direction = '', character_id = '', art_style_id = '', refine_note = '', count = 3 } = req.body;
  const product = design.product_data || {};
  const copy = design.selected_copy || {};

  const character = character_id ? db.getCharacter(character_id) : null;
  const artStyle  = art_style_id  ? db.getArtStyle(art_style_id)  : null;

  // Load cover reference image
  const coverRefPart = (() => {
    if (!design.cover_ref_image) return null;
    const filename = path.basename(design.cover_ref_image);
    const fullPath = path.join(UPLOADS_DIR, 'cover-refs', filename);
    if (!fs.existsSync(fullPath)) return null;
    try {
      const buf = fs.readFileSync(fullPath);
      const ext = path.extname(fullPath).slice(1).toLowerCase();
      const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      return { inlineData: { mimeType, data: buf.toString('base64') } };
    } catch { return null; }
  })();

  // Load selected sketch as reference
  const sketchRefPart = (() => {
    if (!design.selected_sketch_url) return null;
    const filename = path.basename(design.selected_sketch_url);
    const fullPath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(fullPath)) return null;
    try {
      const buf = fs.readFileSync(fullPath);
      const ext = path.extname(fullPath).slice(1).toLowerCase();
      const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      return { inlineData: { mimeType, data: buf.toString('base64') } };
    } catch { return null; }
  })();

  // Load selected cover sketch as reference
  const selectedCoverSketchPart = (() => {
    if (!design.selected_cover_sketch_url) return null;
    const filename = path.basename(design.selected_cover_sketch_url);
    const fullPath = path.join(UPLOADS_DIR, filename);
    if (!fs.existsSync(fullPath)) return null;
    try {
      const buf = fs.readFileSync(fullPath);
      const ext = path.extname(fullPath).slice(1).toLowerCase();
      const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
      return { inlineData: { mimeType, data: buf.toString('base64') } };
    } catch { return null; }
  })();

  const buildPrompt = () => {
    const lines = [
      `Create a detailed full-color product illustration for a Lovepop pop-up greeting card.`,
      `PRODUCT: ${product.name || design.product_title || 'Lovepop Card'}`,
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

    if (sketchRefPart) lines.push(`\nSELECTED INSIDE SKETCH: An inside sketch has been provided as the structural/compositional reference. Translate it into a polished full-color illustration — preserve the layout and pop-up structure while applying the art style.`);
    if (selectedCoverSketchPart) lines.push(`\nSELECTED COVER SKETCH: A cover sketch has been provided as compositional reference for the card cover. Use it to guide the cover design and layout.`);
    if (coverRefPart)  lines.push(`\nCOVER REFERENCE: A cover reference image is provided. Use it to guide the cover composition and layout style.`);
    if (direction)     lines.push(`\nDirection / notes: ${direction}`);
    if (refine_note)   lines.push(`\nRefinement: ${refine_note}`);

    const prevRounds = design.concept_rounds || [];
    if (prevRounds.length > 0) {
      lines.push(`\nThis is round ${prevRounds.length + 1}. Vary the composition and interpretation while keeping the core brief.`);
    }

    lines.push(
      `\nCreate a polished product illustration showing:`,
      `1. Card cover with beautiful full-color artwork`,
      `2. Inside spread with the 3D pop-up sculpture rendered in full color`,
      `Lovepop's signature warm, intricate, paper-art aesthetic. Full color, detailed, beautiful.`,
    );

    return lines.filter(Boolean).join('\n');
  };

  const buildRefParts = () => {
    const parts = [];
    if (sketchRefPart)           parts.push(sketchRefPart);
    if (selectedCoverSketchPart) parts.push(selectedCoverSketchPart);
    if (coverRefPart)            parts.push(coverRefPart);
    if (character?.images?.length) parts.push(...loadRefParts(character.images.slice(0, 2)));
    if (artStyle?.images?.length)  parts.push(...loadRefParts(artStyle.images.slice(0, 2)));
    return parts;
  };

  const generateOne = async () => {
    const refParts = buildRefParts();
    const base64 = await geminiGenerateImage(geminiKey, model, buildPrompt(), refParts);
    return saveBase64Image(base64, 'cd-concept');
  };

  try {
    const n = Math.min(Math.max(1, parseInt(count, 10) || 3), 9);
    const urls = await Promise.all(Array.from({ length: n }, () => generateOne()));
    const newRound = {
      id: crypto.randomBytes(8).toString('hex'),
      index: (design.concept_rounds?.length || 0) + 1,
      created_at: new Date().toISOString(),
      refine_note: refine_note || direction || '',
      cards: urls.map(url => ({ id: crypto.randomBytes(8).toString('hex'), url, note: '' })),
    };
    const updatedRounds = [...(design.concept_rounds || []), newRound];
    const updated = db.updateCardDesign(req.params.id, { concept_rounds: updatedRounds });
    res.json({ round: newRound, design: updated });
  } catch (e) {
    console.error('[card-designer] generate-concept error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Update concept card note ────────────────────────────────────
router.patch('/designs/:id/concept/card/:cardId', (req, res) => {
  try {
    const design = db.getCardDesign(req.params.id);
    if (!design) return res.status(404).json({ error: 'Design not found' });
    const { note } = req.body;
    const allRounds = design.concept_rounds || [];
    for (const r of allRounds) {
      const card = r.cards.find(c => c.id === req.params.cardId);
      if (card) { if (note !== undefined) card.note = note; break; }
    }
    const updated = db.updateCardDesign(req.params.id, { concept_rounds: allRounds });
    res.json(updated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
