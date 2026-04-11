const express = require('express');
const router = express.Router();
const db = require('../database');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const Anthropic = require('@anthropic-ai/sdk');
const sharp = require('sharp');

// Temp storage for uploaded source images
const ASSET_TEMP_DIR = process.env.ASSET_TEMP_DIR || '/tmp/asset_segments';
if (!fs.existsSync(ASSET_TEMP_DIR)) fs.mkdirSync(ASSET_TEMP_DIR, { recursive: true });

const assetStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, ASSET_TEMP_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const assetUpload = multer({ storage: assetStorage, limits: { fileSize: 50 * 1024 * 1024 } });

// GET /api/asset-library/jobs
router.get('/jobs', (req, res) => {
  try {
    const jobs = db.listAssetJobs();
    res.json(jobs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/asset-library/jobs/:id
router.get('/jobs/:id', (req, res) => {
  try {
    const job = db.getAssetJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    const segments = db.listSegmentsForJob(req.params.id);
    res.json({ ...job, segments });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/asset-library/segment — accept files + metadata, create job, trigger worker
router.post('/segment', assetUpload.array('files', 20), async (req, res) => {
  try {
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' });

    const metadata = JSON.parse(req.body.metadata || '{}');
    const skuIds = JSON.parse(req.body.sku_ids || '[]');
    const boxFolder = req.body.box_folder || '';
    const notes = req.body.notes || '';

    const sourceFiles = files.map(f => ({
      filename: f.originalname,
      size: f.size,
      temp_path: f.path
    }));

    const job = db.createAssetJob({
      status: 'queued',
      source_files: sourceFiles,
      sku_ids: skuIds,
      metadata,
      box_folder: boxFolder,
      notes,
      segment_count: 0
    });

    // Respond immediately, run segmentation async
    res.json({ job_id: job.id, message: 'Job created, segmentation starting' });

    // Run segmentation asynchronously
    runSegmentation(job.id, files, metadata).catch(err => {
      console.error('Segmentation error:', err);
      db.updateAssetJob(job.id, { status: 'failed', error_message: err.message });
    });

  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function runSegmentation(jobId, files, metadata) {
  db.updateAssetJob(jobId, { status: 'processing' });

  const settings = {
    sam2ModelPath: db.getSetting('sam2_model_path') || (process.env.SAM2_MODEL_PATH || ''),
    minPct: parseFloat(db.getSetting('sam2_min_segment_pct') || '5'),
    maxPct: parseFloat(db.getSetting('sam2_max_segment_pct') || '90'),
    confidence: parseFloat(db.getSetting('sam2_confidence') || '0.88'),
  };

  let totalSegments = 0;
  const errors = [];

  for (const file of files) {
    try {
      db.updateAssetJob(jobId, { status: `processing:${file.originalname}` });
      const segments = await runSAM2(file.path, settings, jobId, file.originalname, metadata);
      totalSegments += segments.length;
    } catch (err) {
      console.error(`Failed to segment ${file.originalname}:`, err.message);
      errors.push(`${file.originalname}: ${err.message}`);
    }
  }

  if (totalSegments === 0 && errors.length > 0) {
    db.updateAssetJob(jobId, {
      status: 'failed',
      segment_count: 0,
      error_message: errors.join(' | ')
    });
  } else {
    db.updateAssetJob(jobId, {
      status: 'complete',
      segment_count: totalSegments,
      error_message: errors.length ? `Partial errors: ${errors.join(' | ')}` : ''
    });
  }
}

async function runSAM2(imagePath, settings, jobId, sourceFilename, metadata) {
  const modelPath = settings.sam2ModelPath;

  // If SAM2 model is installed, use the Python worker
  if (modelPath && fs.existsSync(modelPath)) {
    return runSAM2Python(imagePath, settings, jobId, sourceFilename, metadata);
  }

  // Otherwise fall back to Claude Vision segmentation (works on Railway with no extra setup)
  console.log('SAM2 model not found — using Claude Vision segmentation for', sourceFilename);
  return runClaudeSegmentation(imagePath, jobId, sourceFilename, metadata, settings);
}

function runSAM2Python(imagePath, settings, jobId, sourceFilename, metadata) {
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, '../workers/asset_segmenter.py');
    const args = [
      workerPath,
      '--image', imagePath,
      '--model', settings.sam2ModelPath,
      '--job-id', jobId,
      '--source-filename', sourceFilename,
      '--min-pct', String(settings.minPct),
      '--max-pct', String(settings.maxPct),
      '--confidence', String(settings.confidence),
      '--output-dir', ASSET_TEMP_DIR,
    ];
    const py = spawn('python3', args);
    let stdout = '', stderr = '';
    py.stdout.on('data', d => stdout += d.toString());
    py.stderr.on('data', d => stderr += d.toString());
    py.on('close', code => {
      if (code !== 0) return reject(new Error(`Python worker exited ${code}: ${stderr}`));
      try {
        const result = JSON.parse(stdout);
        const segments = result.segments.map(s => db.createAssetSegment({
          job_id: jobId, source_filename: sourceFilename, status: 'pending_review',
          temp_path: s.path, mask_bbox: s.bbox, metadata,
          element_label: '', auto_label: '', element_type: 'other'
        }));
        resolve(segments);
      } catch (e) { reject(new Error(`Failed to parse worker output: ${e.message}`)); }
    });
  });
}

async function runClaudeSegmentation(imagePath, jobId, sourceFilename, metadata, settings) {
  const apiKey = db.getSetting('anthropic_api_key') || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('No Anthropic API key configured. Add it in Settings to enable segmentation.');
  }

  // Load original image — we crop from this at full resolution
  const originalBuffer = fs.readFileSync(imagePath);
  const origMeta = await sharp(originalBuffer).metadata();
  const origW = origMeta.width;
  const origH = origMeta.height;

  // Prepare a smaller JPEG version for sending to Claude.
  // Anthropic's limit is 5MB base64; JPEG at 1568px stays well under 1MB.
  // We tell Claude the resized dimensions and scale its coordinates back to
  // original resolution when cropping.
  const MAX_DIM = 1568;
  const scale = Math.min(1, MAX_DIM / Math.max(origW, origH));
  const claudeW = Math.round(origW * scale);
  const claudeH = Math.round(origH * scale);

  const claudeBuffer = await sharp(originalBuffer)
    .resize(claudeW, claudeH)
    .jpeg({ quality: 90 })
    .toBuffer();

  const base64 = claudeBuffer.toString('base64');
  const mediaType = 'image/jpeg';
  const scaleX = origW / claudeW;   // multiply Claude x/w coords by this to get original px
  const scaleY = origH / claudeH;

  console.log(`Image: ${origW}×${origH} → Claude payload: ${claudeW}×${claudeH} JPEG (${Math.round(base64.length / 1024)}KB base64)`);

  const client = new Anthropic({ apiKey });

  const prompt = `You are segmenting a Lovepop pop-up card illustration into its individual visual elements for a digital asset library.

The image is ${claudeW}×${claudeH} pixels.

Identify EVERY distinct visual element — flowers, leaves, stems, characters, animals, objects, ribbons, banners, decorative accents, etc. Be thorough and find as many separable elements as possible. Err heavily on the side of MORE elements.

For each element give its tight bounding box in pixels (x, y from top-left corner, w = width, h = height).

Rules:
- Include every element you can see, no matter how small (minimum bounding box 20×20px)
- Do NOT include one box covering the entire image
- Overlapping boxes are fine — elements often overlap
- Give each element a short descriptive label (3–5 words, color + subject)

Respond with ONLY a valid JSON array — no explanation, no markdown fences:
[
  {"label":"Pink peony full bloom","type":"flower","x":120,"y":80,"w":210,"h":195},
  {"label":"Green curved stem","type":"leaf_stem","x":180,"y":240,"w":40,"h":160}
]

Valid types: flower, leaf_stem, accent, foliage, character, animal, object, background, other`;

  let rawText = '';
  let elements = [];
  try {
    console.log(`Calling Claude API with ${Math.round(base64.length / 1024)}KB base64 payload...`);
    const response = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: prompt }
        ]
      }]
    });
    console.log(`Claude API call succeeded, stop_reason: ${response.stop_reason}`);

    rawText = response.content[0]?.text?.trim() || '';
    console.log(`Claude segmentation raw response (first 500 chars): ${rawText.slice(0, 500)}`);

    // Strip markdown fences if present, then extract JSON array
    const cleaned = rawText.replace(/```json?/gi, '').replace(/```/g, '').trim();
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      elements = JSON.parse(jsonMatch[0]);
    }
  } catch (err) {
    const errDetails = `${err.constructor?.name || 'Error'}: ${err.message}` +
      (err.status ? ` (HTTP ${err.status})` : '') +
      (err.error ? ` — ${JSON.stringify(err.error)}` : '');
    console.error('Claude segmentation error:', errDetails, '| raw:', rawText.slice(0, 300));
    throw new Error(`Claude segmentation failed: ${errDetails}`);
  }

  if (!elements.length) {
    const preview = rawText.slice(0, 200);
    throw new Error(`Claude returned no elements. Raw response: "${preview}"`);
  }

  console.log(`Claude identified ${elements.length} elements in ${sourceFilename}`);

  // Crop each element using sharp, save as PNG
  // Claude saw a resized image; scale its pixel coordinates back to original resolution
  const imgArea = origW * origH;
  const segments = [];

  for (const el of elements) {
    try {
      // Scale Claude's coordinates back to original image resolution
      const x = Math.max(0, Math.round(el.x * scaleX));
      const y = Math.max(0, Math.round(el.y * scaleY));
      const w = Math.min(Math.round(el.w * scaleX), origW - x);
      const h = Math.min(Math.round(el.h * scaleY), origH - y);

      if (w < 10 || h < 10) continue;

      const pct = ((w * h) / imgArea) * 100;

      // Add a small padding around the crop (10px each side, clamped)
      const pad = 10;
      const cx = Math.max(0, x - pad);
      const cy = Math.max(0, y - pad);
      const cw = Math.min(w + pad * 2, origW - cx);
      const ch = Math.min(h + pad * 2, origH - cy);

      const segId = require('crypto').randomBytes(8).toString('hex');
      const outPath = path.join(ASSET_TEMP_DIR, `${segId}.png`);

      await sharp(originalBuffer)
        .extract({ left: cx, top: cy, width: cw, height: ch })
        .png()
        .toFile(outPath);

      const seg = db.createAssetSegment({
        job_id: jobId,
        source_filename: sourceFilename,
        status: 'pending_review',
        temp_path: outPath,
        mask_bbox: { x, y, w, h, pct_of_image: Math.round(pct * 10) / 10 },
        metadata,
        element_label: el.label || '',
        auto_label: el.label || '',
        element_type: el.type || 'other'
      });

      segments.push(seg);
    } catch (cropErr) {
      console.warn(`Failed to crop element "${el.label}":`, cropErr.message);
    }
  }

  if (!segments.length) {
    throw new Error('Segmentation produced no valid crops. Check image dimensions and try again.');
  }

  return segments;
}

// GET /api/asset-library/segments/:id/image — serve segment image file
router.get('/segments/:id/image', (req, res) => {
  try {
    const seg = db.getAssetSegment(req.params.id);
    if (!seg) return res.status(404).json({ error: 'Not found' });
    if (!seg.temp_path || !fs.existsSync(seg.temp_path)) {
      return res.status(404).json({ error: 'Image file not found' });
    }
    res.sendFile(path.resolve(seg.temp_path));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/asset-library/segments/:id
router.get('/segments/:id', (req, res) => {
  try {
    const seg = db.getAssetSegment(req.params.id);
    if (!seg) return res.status(404).json({ error: 'Not found' });
    res.json(seg);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/asset-library/segments/:id
router.patch('/segments/:id', (req, res) => {
  try {
    const { element_label, element_type, status, notes, reviewed_by } = req.body;
    const updates = {};
    if (element_label !== undefined) updates.element_label = element_label;
    if (element_type !== undefined) updates.element_type = element_type;
    if (status !== undefined) updates.status = status;
    if (notes !== undefined) updates.notes = notes;
    if (reviewed_by !== undefined) updates.reviewed_by = reviewed_by;
    if (status === 'approved' || status === 'rejected') {
      updates.reviewed_at = new Date().toISOString();
    }
    db.updateAssetSegment(req.params.id, updates);
    res.json(db.getAssetSegment(req.params.id));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/asset-library/auto-label — Claude API for label suggestion
router.post('/auto-label', async (req, res) => {
  try {
    const { segment_id } = req.body;
    const seg = db.getAssetSegment(segment_id);
    if (!seg) return res.status(404).json({ error: 'Segment not found' });

    const autoLabelEnabled = db.getSetting('asset_auto_label') !== 'false';
    if (!autoLabelEnabled) return res.json({ label: '' });

    const apiKey = db.getSetting('anthropic_api_key') || process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.json({ label: '' });

    // Read the segment image
    if (!seg.temp_path || !fs.existsSync(seg.temp_path)) {
      return res.json({ label: '' });
    }

    const imageBuffer = fs.readFileSync(seg.temp_path);
    const base64Image = imageBuffer.toString('base64');
    const ext = path.extname(seg.temp_path).toLowerCase();
    const mediaType = ext === '.png' ? 'image/png' : 'image/jpeg';

    const model = db.getSetting('asset_auto_label_model') || 'claude-haiku-4-5';
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model,
      max_tokens: 50,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Image } },
          { type: 'text', text: 'Describe this isolated illustration element in 4 words or fewer. Focus on subject and color. Examples: "Pink peony bud", "Green fern frond", "Red cardinal bird". Reply with only the label, nothing else.' }
        ]
      }]
    });

    const label = response.content[0]?.text?.trim() || '';
    db.updateAssetSegment(segment_id, { auto_label: label });
    res.json({ label });
  } catch (e) {
    console.error('Auto-label error:', e.message);
    res.json({ label: '' });
  }
});

// POST /api/asset-library/jobs/:id/upload-approved — upload approved segments to Box
router.post('/jobs/:id/upload-approved', async (req, res) => {
  try {
    const job = db.getAssetJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    const segments = db.listSegmentsForJob(req.params.id);
    const approved = segments.filter(s => s.status === 'approved');

    if (!approved.length) return res.json({ uploaded: 0, message: 'No approved segments' });

    // Check Box credentials
    const boxClientId = db.getSetting('box_client_id');
    if (!boxClientId) {
      return res.status(400).json({ error: 'Box credentials not configured. Add them in Settings.' });
    }

    // For now, simulate Box upload (real Box SDK integration in boxService.js)
    const uploaded = [];
    for (const seg of approved) {
      const mockBoxUrl = `https://app.box.com/file/${seg.id}`;

      db.updateAssetSegment(seg.id, {
        status: 'library',
        box_file_id: seg.id,
        box_url: mockBoxUrl
      });

      db.addToAssetLibrary({
        segment_id: seg.id,
        box_file_id: seg.id,
        box_url: mockBoxUrl,
        element_label: seg.element_label || seg.auto_label || '',
        element_type: seg.element_type || '',
        sku_ids: job.sku_ids || [],
        occasion: seg.metadata?.occasion || '',
        theme: seg.metadata?.theme || '',
        sub_theme: seg.metadata?.sub_theme || '',
        art_style: seg.metadata?.art_style || '',
        color_family: seg.metadata?.color_family || [],
        content_type: seg.metadata?.content_type || [],
        source_filename: seg.source_filename || '',
        approved_by: '',
        approved_at: new Date().toISOString()
      });

      uploaded.push(seg.id);
    }

    res.json({ uploaded: uploaded.length, message: `${uploaded.length} assets uploaded to library` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/asset-library/assets
router.get('/assets', (req, res) => {
  try {
    const filters = {
      search: req.query.search || '',
      occasion: req.query.occasion || '',
      art_style: req.query.art_style || '',
      element_type: req.query.element_type || '',
      color_family: req.query.color_family || '',
    };
    const assets = db.listAssetLibrary(filters);
    res.json(assets);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/asset-library/assets/:id
router.get('/assets/:id', (req, res) => {
  try {
    const asset = db.getAssetLibraryItem(req.params.id);
    if (!asset) return res.status(404).json({ error: 'Not found' });
    res.json(asset);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/asset-library/segments/merge — merge two adjacent segments
router.post('/segments/merge', (req, res) => {
  try {
    const { segment_id_a, segment_id_b } = req.body;
    const segA = db.getAssetSegment(segment_id_a);
    const segB = db.getAssetSegment(segment_id_b);
    if (!segA || !segB) return res.status(404).json({ error: 'Segment not found' });

    // Merge: keep segA, mark segB as rejected, combine labels
    const mergedLabel = [segA.element_label || segA.auto_label, segB.element_label || segB.auto_label]
      .filter(Boolean).join(' + ');

    db.updateAssetSegment(segment_id_a, { element_label: mergedLabel });
    db.updateAssetSegment(segment_id_b, { status: 'rejected' });

    res.json({ merged_into: segment_id_a, label: mergedLabel });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/asset-library/box/test — test Box connection
router.get('/box/test', async (req, res) => {
  try {
    const clientId = db.getSetting('box_client_id');
    if (!clientId) return res.json({ ok: false, message: 'Box credentials not configured' });
    // Real Box test would go here; for now just check credentials exist
    res.json({ ok: true, message: 'Box credentials configured (connection test requires boxsdk)' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
