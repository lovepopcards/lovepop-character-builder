/* ============================================================
   Lovepop Character Builder — Frontend App
   ============================================================ */

const API      = '/api/characters';
const LANDS_API = '/api/lands';

let characters = [];
let lands = [];
let currentView = 'catalog';
let displayMode = 'tile';
let landsDisplayMode = 'tile';
let activeDetailId = null;
let activeLandDetailId = null;
let editorMode = 'create';
let editorCharId = null;
let landEditorMode = 'create';
let landEditorId = null;
let aiImageFile = null;
let landAiImageFile = null;
let aiGeneratedData = {};
let landAiGeneratedData = {};
let pendingCharImages = [];      // File[] queued for upload on create
let pendingCharGenUrls = [];     // already-on-server URLs from accepted generated artwork
let pendingLandImages = [];      // File[] queued for upload on create
let pendingLandGenUrls = [];     // already-on-server URLs from accepted generated images

const CHAR_FIELD_META = [
  { key: 'name',                 label: 'Name',                   inputId: 'f-name' },
  { key: 'species',              label: 'Species',                inputId: 'f-species' },
  { key: 'role',                 label: 'Role',                   inputId: 'f-role' },
  { key: 'backstory',            label: 'Backstory',              inputId: 'f-backstory' },
  { key: 'personality',          label: 'Personality',            inputId: 'f-personality' },
  { key: 'key_passions',         label: 'Key Passions',           inputId: 'f-key-passions' },
  { key: 'what_they_care_about', label: 'What They Care About',   inputId: 'f-what-they-care-about' },
  { key: 'tone_and_voice',       label: 'Tone & Voice',           inputId: 'f-tone-and-voice' },
  { key: 'hook_and_audience',    label: 'My Hook & Audience',     inputId: 'f-hook-and-audience' },
];

const LAND_FIELD_META = [
  { key: 'name',               label: 'Name',              inputId: 'fl-name' },
  { key: 'description',        label: 'Description',       inputId: 'fl-description' },
  { key: 'visual_style',       label: 'Visual Style',      inputId: 'fl-visual-style' },
  { key: 'color_palette',      label: 'Color Palette',     inputId: 'fl-color-palette' },
  { key: 'themes_and_content', label: 'Themes & Content',  inputId: 'fl-themes-and-content' },
];

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const bindFns = [
    bindNav, bindCatalog, bindEditor, bindAIPanel,
    bindLands, bindLandEditor, bindLandAIPanel, bindProductPicker,
    bindDetailModal, bindLandDetailModal, bindSettings,
    bindCharArtGenerator, bindLandImageGenerator, bindAssetLibrary,
    bindCharStories, bindBulkEdit,
  ];
  for (const fn of bindFns) {
    try { fn(); }
    catch (err) { console.error(`[init] ${fn.name} threw:`, err); }
  }
  loadAll();
  checkApiKeyStatus();
});

// ── Load everything ───────────────────────────────────────────
async function loadAll() {
  await Promise.all([loadCharacters(), loadLands(), loadSalesData()]);
}

// ── Sales Data ────────────────────────────────────────────────
let salesData = {};   // keyed by SKU → { t12m_revenue, t12m_units, asp }

async function loadSalesData() {
  try {
    const res = await fetch('/api/sales');
    if (res.ok) salesData = await res.json();
  } catch { /* silently ignore — sales data is non-critical */ }
}

function fmtRevenue(n) {
  if (!n || isNaN(n)) return null;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000)     return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function fmtUnits(n) {
  if (!n || isNaN(n)) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 1_000)     return `${Math.round(n / 1_000)}K`;
  return `${Math.round(n)}`;
}

function fmtAsp(n) {
  if (!n || isNaN(n)) return null;
  return `$${Number(n).toFixed(2)}`;
}

// Build the inner HTML for a product card body (with optional sales row)
function buildProductCardBody(p) {
  const s = salesData[p.sku];
  const rev   = s ? fmtRevenue(s.t12m_revenue) : null;
  const units = s ? fmtUnits(s.t12m_units)     : null;
  const asp   = s ? fmtAsp(s.asp)              : null;
  const hasSales = rev || units || asp;

  return `
    <div class="land-pf-card-name">${esc(p.name || p.sku)}</div>
    <div class="land-pf-card-sku">${esc(p.sku)}</div>
    ${rev ? `<div class="pf-sales-rev">${rev} T12M rev</div>` : ''}
    ${hasSales && (units || asp) ? `<div class="pf-sales-metrics">${units ? `Units ${units}` : ''}${units && asp ? ' &nbsp; ' : ''}${asp ? `ASP ${asp}` : ''}</div>` : ''}`;
}

// ── Navigation ────────────────────────────────────────────────
function bindNav() {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });
}

function switchView(view) {
  currentView = view;
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
  if (view === 'settings') loadSettings();
}

function goBack(dest) {
  switchView(dest);
}

// ── Characters Data ───────────────────────────────────────────
async function loadCharacters() {
  try {
    const res = await fetch(API);
    characters = await res.json();
    renderCatalog();
  } catch (err) { console.error('Load chars error:', err); }
}

async function saveCharacter(data) {
  if (editorMode === 'edit' && editorCharId) {
    const res = await fetch(`${API}/${editorCharId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!res.ok) throw new Error('Update failed');
    return res.json();
  }
  const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!res.ok) throw new Error('Create failed');
  return res.json();
}

// ── Catalog (Characters) ──────────────────────────────────────
function bindCatalog() {
  document.getElementById('btn-tile-view').addEventListener('click', () => setDisplayMode('tile'));
  document.getElementById('btn-list-view').addEventListener('click', () => setDisplayMode('list'));
  document.getElementById('catalog-new-btn').addEventListener('click', () => openEditorView('create'));
  document.getElementById('empty-new-btn').addEventListener('click', () => openEditorView('create'));
  document.getElementById('catalog-export-btn').addEventListener('click', exportCharactersToExcel);
}

function setDisplayMode(mode) {
  displayMode = mode;
  document.getElementById('btn-tile-view').classList.toggle('active', mode === 'tile');
  document.getElementById('btn-list-view').classList.toggle('active', mode === 'list');
  document.getElementById('tile-view').classList.toggle('hidden', mode !== 'tile');
  document.getElementById('list-view').classList.toggle('hidden', mode !== 'list');
}

function renderCatalog() {
  const n = characters.length;
  document.getElementById('catalog-count').textContent = `${n} character${n !== 1 ? 's' : ''}`;
  renderTileView();
  renderListView();
}

function renderTileView() {
  const grid = document.getElementById('tile-view');
  const empty = document.getElementById('catalog-empty');
  Array.from(grid.children).forEach(el => { if (el.id !== 'catalog-empty') el.remove(); });
  if (!characters.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  characters.forEach(char => grid.appendChild(buildCharTile(char)));
}

function renderListView() {
  const tbody = document.getElementById('list-body');
  const empty = document.getElementById('list-empty');
  tbody.innerHTML = '';
  if (!characters.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  characters.forEach(char => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><div class="list-char-name">${esc(char.name)}</div>${char.species ? `<div class="list-char-sub">${esc(char.species)}</div>` : ''}</td>
      <td><span class="list-meta">${esc(char.role || '—')}</span></td>
      <td><span class="status-badge status-${char.status}">${cap(char.status)}</span></td>
      <td><span class="list-meta">${esc(char.first_appeared || '—')}</span></td>
      <td><span class="list-meta">${fmtDate(char.created_at)}</span></td>
      <td style="text-align:right"><button class="btn-secondary" style="font-size:11px;padding:4px 10px">View →</button></td>
    `;
    tr.addEventListener('click', () => openDetailModal(char.id));
    tbody.appendChild(tr);
  });
}

function buildCharTile(char) {
  const tile = document.createElement('div');
  tile.className = 'character-tile';
  const imgHtml = char.images && char.images.length
    ? `<img src="${esc(char.images[0])}" alt="${esc(char.name)}" loading="lazy" />`
    : `<div class="tile-image-placeholder">✨</div>`;
  tile.innerHTML = `
    <div class="tile-image">${imgHtml}<span class="tile-status-badge status-badge status-${char.status}">${cap(char.status)}</span></div>
    <div class="tile-body">
      <div class="tile-name">${esc(char.name)}</div>
      ${char.species || char.role ? `<div class="tile-sub">${esc([char.species, char.role].filter(Boolean).join(' · '))}</div>` : ''}
    </div>`;
  tile.addEventListener('click', () => openDetailModal(char.id));
  return tile;
}

// ── Character Editor ──────────────────────────────────────────
function openEditorView(mode, charId = null) {
  editorMode = mode;
  editorCharId = charId;
  aiGeneratedData = {};
  aiImageFile = null;
  pendingCharImages = [];
  pendingCharGenUrls = [];
  charArtRefFiles = [];
  charArtGenUrl = null;
  document.getElementById('char-art-preview-wrap')?.classList.add('hidden');
  document.getElementById('char-art-status')?.classList.add('hidden');
  renderCharArtRefs();
  clearAIPanel();
  clearCharProductSelection();
  if (mode === 'edit' && charId) {
    const char = characters.find(c => c.id === charId);
    if (!char) return;
    document.getElementById('editor-title').textContent = char.name;
    CHAR_FIELD_META.forEach(f => { const el = document.getElementById(f.inputId); if (el) el.value = char[f.key] || ''; });
    document.getElementById('f-status').value = char.status || 'active';
    document.getElementById('f-first-appeared').value = char.first_appeared || '';
    renderEditorImages(char.images || []);
    if (char.product_skus && char.product_skus.length) {
      restoreCharProductSelection(char.product_skus);
    }
  } else {
    document.getElementById('editor-title').textContent = 'New Character';
    CHAR_FIELD_META.forEach(f => { const el = document.getElementById(f.inputId); if (el) el.value = ''; });
    document.getElementById('f-status').value = 'active';
    document.getElementById('f-first-appeared').value = '';
    renderEditorImages([]);
  }
  document.getElementById('editor-save-status').textContent = '';
  // Always start on story tab
  switchEditorTab('story');
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-editor').classList.add('active');
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  currentView = 'editor';
  window.scrollTo(0, 0);
}

// renderEditorImages — kept for backward compat (called on editor open)
function renderEditorImages(existingUrls) {
  renderApprovedGallery();
  renderSourceGallery();
}

async function handleCharImageRemove(idx) {
  if (editorMode === 'edit' && editorCharId) {
    try {
      const res = await fetch(`${API}/${editorCharId}/images/${idx}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Remove failed');
      const updated = await res.json();
      characters = characters.map(c => c.id === updated.id ? updated : c);
      renderEditorImages(updated.images || []);
      renderCatalog();
    } catch (err) { alert('Could not remove image: ' + err.message); }
  }
}

// ── Editor tab switching (characters) ────────────────────────
function switchEditorTab(tab) {
  document.querySelectorAll('#view-editor .editor-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  document.getElementById('editor-tab-story').classList.toggle('hidden', tab !== 'story');
  document.getElementById('editor-tab-artwork').classList.toggle('hidden', tab !== 'artwork');
  document.getElementById('editor-tab-products').classList.toggle('hidden', tab !== 'products');
  document.getElementById('editor-tab-char-stories').classList.toggle('hidden', tab !== 'char-stories');
  if (tab === 'artwork') { renderApprovedGallery(); renderSourceGallery(); }
  if (tab === 'char-stories') { loadCharStories(); }
}

// ── Land editor tab switching ─────────────────────────────────
function switchLandEditorTab(tab) {
  document.querySelectorAll('#view-land-editor .editor-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  document.getElementById('land-editor-tab-profile').classList.toggle('hidden', tab !== 'land-profile');
  document.getElementById('land-editor-tab-artwork').classList.toggle('hidden', tab !== 'land-artwork');
  document.getElementById('land-editor-tab-products').classList.toggle('hidden', tab !== 'land-products');
}

function bindEditor() {
  // Tab buttons
  document.querySelectorAll('.editor-tab').forEach(btn => {
    btn.addEventListener('click', () => switchEditorTab(btn.dataset.tab));
  });

  document.getElementById('editor-back-btn').addEventListener('click', () => goBack('catalog'));
  document.getElementById('editor-cancel-btn').addEventListener('click', () => goBack('catalog'));
  document.getElementById('editor-save-btn').addEventListener('click', handleEditorSave);

  // Source Images upload — adds character images (saved to char.images)
  document.getElementById('char-source-upload').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    if (editorMode === 'edit' && editorCharId) {
      const btn = document.getElementById('editor-save-btn');
      btn.disabled = true;
      const prevText = btn.textContent; btn.textContent = 'Uploading…';
      try {
        let updated;
        for (const file of files) {
          const fd = new FormData(); fd.append('image', file);
          const res = await fetch(`${API}/${editorCharId}/images`, { method: 'POST', body: fd });
          if (!res.ok) throw new Error('Upload failed');
          updated = await res.json();
        }
        characters = characters.map(c => c.id === updated.id ? updated : c);
        renderSourceGallery();
        renderCatalog();
      } catch (err) { alert('Upload failed: ' + err.message); }
      finally { btn.disabled = false; btn.textContent = prevText; }
    } else {
      pendingCharImages.push(...files);
      renderSourceGallery();
    }
    e.target.value = '';
  });
}

// ── Generated Assets gallery (artwork tab right, top) ─────────
// Only shows AI-generated artwork accepted from the Artwork Generator (pendingCharGenUrls)
function renderApprovedGallery() {
  const gallery = document.getElementById('editor-images-gallery');
  const empty   = document.getElementById('char-approved-empty');
  if (!gallery) return;

  gallery.innerHTML = '';
  if (!pendingCharGenUrls.length) {
    empty?.classList.remove('hidden');
    return;
  }
  empty?.classList.add('hidden');

  pendingCharGenUrls.forEach((url, idx) => {
    const item = document.createElement('div');
    item.className = 'editor-image-item';
    item.innerHTML = `
      <img src="${esc(url)}" alt="Generated ${idx + 1}" loading="lazy" />
      <span class="img-gen-badge">✨ AI</span>
      <button class="img-remove-btn" title="Remove">✕</button>`;
    item.querySelector('.img-remove-btn').addEventListener('click', () => {
      pendingCharGenUrls = pendingCharGenUrls.filter(u => u !== url);
      renderApprovedGallery();
    });
    gallery.appendChild(item);
  });
}

// ── Source Images gallery (artwork tab right, bottom) ─────────
// Shows: saved char.images (server URLs) + pendingCharImages (queued uploads) + charArtRefFiles (generator refs)
function renderSourceGallery() {
  const gallery = document.getElementById('char-source-gallery');
  const empty   = document.getElementById('char-source-empty');
  if (!gallery) return;

  gallery.innerHTML = '';

  const char = editorMode === 'edit' ? characters.find(c => c.id === editorCharId) : null;
  const savedUrls = char ? (char.images || []) : [];
  const totalCount = savedUrls.length + pendingCharImages.length + charArtRefFiles.length;

  if (!totalCount) {
    empty?.classList.remove('hidden');
    return;
  }
  empty?.classList.add('hidden');

  // Saved character images (already on server)
  savedUrls.forEach((url, idx) => {
    const item = document.createElement('div');
    item.className = 'editor-image-item';
    const img = document.createElement('img');
    img.src = url; img.alt = `Character image ${idx + 1}`; img.loading = 'lazy';
    if (idx === 0) {
      const badge = document.createElement('span');
      badge.className = 'img-primary-badge'; badge.textContent = 'Primary';
      item.appendChild(badge);
    }
    const removeBtn = document.createElement('button');
    removeBtn.className = 'img-remove-btn'; removeBtn.textContent = '✕'; removeBtn.title = 'Remove';
    removeBtn.addEventListener('click', () => handleCharImageRemove(idx));
    item.appendChild(img); item.appendChild(removeBtn);
    gallery.appendChild(item);
  });

  // Pending character images (queued File objects, not yet uploaded)
  pendingCharImages.forEach((file, idx) => {
    const item = document.createElement('div');
    item.className = 'editor-image-item';
    const img = document.createElement('img'); img.alt = `New image ${idx + 1}`;
    const reader = new FileReader();
    reader.onload = e => { img.src = e.target.result; };
    reader.readAsDataURL(file);
    const removeBtn = document.createElement('button');
    removeBtn.className = 'img-remove-btn'; removeBtn.textContent = '✕'; removeBtn.title = 'Remove';
    removeBtn.addEventListener('click', () => {
      pendingCharImages.splice(idx, 1);
      renderSourceGallery();
    });
    item.appendChild(img); item.appendChild(removeBtn);
    gallery.appendChild(item);
  });

  // Art reference files (used by the Artwork Generator — not saved directly to character)
  charArtRefFiles.forEach((file, idx) => {
    const item = document.createElement('div');
    item.className = 'editor-image-item';
    const img = document.createElement('img'); img.alt = `Reference ${idx + 1}`;
    const reader = new FileReader();
    reader.onload = e => { img.src = e.target.result; };
    reader.readAsDataURL(file);
    const badge = document.createElement('span');
    badge.className = 'img-gen-badge'; badge.textContent = '🖼 Ref';
    const removeBtn = document.createElement('button');
    removeBtn.className = 'img-remove-btn'; removeBtn.textContent = '✕'; removeBtn.title = 'Remove';
    removeBtn.addEventListener('click', () => {
      charArtRefFiles.splice(idx, 1);
      renderSourceGallery();
      renderCharArtRefs(); // keep generator upload strip in sync
    });
    item.appendChild(img); item.appendChild(badge); item.appendChild(removeBtn);
    gallery.appendChild(item);
  });
}

async function handleEditorSave() {
  const data = {};
  CHAR_FIELD_META.forEach(f => { const el = document.getElementById(f.inputId); if (el) data[f.key] = el.value.trim(); });
  data.status = document.getElementById('f-status').value;
  data.first_appeared = document.getElementById('f-first-appeared').value.trim();

  data.product_skus = [...charSelectedProductSkus];

  if (!data.name) {
    const el = document.getElementById('f-name');
    el.focus(); el.style.borderColor = 'var(--coral)';
    setTimeout(() => el.style.borderColor = '', 1500);
    return;
  }

  const btn = document.getElementById('editor-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    let saved = await saveCharacter(data);
    // Collect all images to upload: AI image first (if new/no images), then any pending picks
    const toUpload = [];
    if (aiImageFile && (editorMode === 'create' || !saved.images || saved.images.length === 0)) {
      toUpload.push(aiImageFile);
    }
    toUpload.push(...pendingCharImages);

    if (toUpload.length) {
      btn.textContent = 'Uploading images…';
      for (const file of toUpload) {
        const fd = new FormData();
        fd.append('image', file);
        const imgRes = await fetch(`${API}/${saved.id}/images`, { method: 'POST', body: fd });
        if (imgRes.ok) saved = await imgRes.json();
      }
    }
    pendingCharImages = [];

    // Include any accepted AI-generated artwork URLs (already on server)
    if (pendingCharGenUrls.length) {
      const mergedImages = [...pendingCharGenUrls, ...(saved.images || []).filter(u => !pendingCharGenUrls.includes(u))];
      const updRes = await fetch(`${API}/${saved.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: mergedImages }),
      });
      if (updRes.ok) saved = await updRes.json();
      pendingCharGenUrls = [];
    }

    if (editorMode === 'edit') {
      characters = characters.map(c => c.id === saved.id ? saved : c);
    } else {
      characters.unshift(saved);
    }
    renderCatalog();
    document.getElementById('editor-save-status').textContent = '✓ Saved';
    setTimeout(() => { switchView('catalog'); }, 600);
  } catch (err) {
    alert('Save failed: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Save Character';
  }
}

// ── AI Panel (Characters) ─────────────────────────────────────
function bindAIPanel() {
  const zone = document.getElementById('ai-image-zone');
  const input = document.getElementById('ai-image-input');
  const clearBtn = document.getElementById('ai-image-clear');

  zone.addEventListener('click', (e) => { if (e.target === clearBtn || clearBtn.contains(e.target)) return; input.click(); });
  input.addEventListener('change', () => { if (input.files[0]) setAIImage(input.files[0], 'char'); });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('drag-over'); const f = e.dataTransfer.files[0]; if (f && f.type.startsWith('image/')) setAIImage(f, 'char'); });
  clearBtn.addEventListener('click', (e) => { e.stopPropagation(); clearAIImage('char'); });

  document.getElementById('ai-generate-btn').addEventListener('click', handleAIGenerate);
  document.getElementById('ai-apply-all-btn').addEventListener('click', () => applyAllAI(CHAR_FIELD_META, aiGeneratedData));
  document.getElementById('ai-goto-settings').addEventListener('click', (e) => { e.preventDefault(); switchView('settings'); loadSettings(); });
}

function setAIImage(file, type) {
  if (type === 'char') {
    aiImageFile = file;
    showAIImagePreview(file, 'ai-image-preview', 'ai-image-placeholder', 'ai-image-clear');
  } else {
    landAiImageFile = file;
    // A directly uploaded file replaces any product selection
    clearLandProductSelection();
    showAIImagePreview(file, 'land-ai-image-preview', 'land-ai-image-placeholder', 'land-ai-image-clear');
  }
}

function showAIImagePreview(file, previewId, placeholderId, clearId) {
  const reader = new FileReader();
  reader.onload = (e) => {
    document.getElementById(previewId).src = e.target.result;
    document.getElementById(previewId).classList.remove('hidden');
    document.getElementById(placeholderId).classList.add('hidden');
    document.getElementById(clearId).classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function clearAIImage(type) {
  if (type === 'char') {
    aiImageFile = null;
    document.getElementById('ai-image-preview').classList.add('hidden');
    document.getElementById('ai-image-placeholder').classList.remove('hidden');
    document.getElementById('ai-image-clear').classList.add('hidden');
    document.getElementById('ai-image-input').value = '';
  } else {
    landAiImageFile = null;
    document.getElementById('land-ai-image-preview').classList.add('hidden');
    document.getElementById('land-ai-image-placeholder').classList.remove('hidden');
    document.getElementById('land-ai-image-clear').classList.add('hidden');
    document.getElementById('land-ai-image-input').value = '';
  }
}

function clearAIPanel() {
  clearAIImage('char');
  document.getElementById('ai-description').value = '';
  document.getElementById('ai-results').classList.add('hidden');
  document.getElementById('ai-result-cards').innerHTML = '';
}

async function handleAIGenerate() {
  const description = document.getElementById('ai-description').value.trim();
  if (!aiImageFile && !description) { document.getElementById('ai-description').focus(); return; }
  await runAIGenerate({
    endpoint: '/api/ai/generate',
    imageFile: aiImageFile,
    description,
    fieldMeta: CHAR_FIELD_META,
    generateBtnId: 'ai-generate-btn',
    resultsId: 'ai-results',
    cardsId: 'ai-result-cards',
    storeIn: (data) => { aiGeneratedData = data; },
  });
}

async function runAIGenerate({ endpoint, imageFile, imageUrls, description, fieldMeta, generateBtnId, resultsId, cardsId, storeIn }) {
  const btn = document.getElementById(generateBtnId);
  const resultsEl = document.getElementById(resultsId);
  const cardsEl = document.getElementById(cardsId);

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Generating…';
  resultsEl.classList.remove('hidden');
  cardsEl.innerHTML = `<div class="ai-loading"><div class="spinner"></div><div>Generating profile…</div></div>`;

  try {
    const fd = new FormData();
    if (imageFile) fd.append('image', imageFile);
    if (imageUrls && imageUrls.length) fd.append('image_urls', JSON.stringify(imageUrls));
    if (description) fd.append('description', description);

    const res = await fetch(endpoint, { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Generation failed');

    storeIn(data);
    renderAIResultCards(data, fieldMeta, cardsEl);
  } catch (err) {
    cardsEl.innerHTML = `<div class="ai-loading" style="color:var(--red)">⚠️ ${esc(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-ai-icon">✨</span> Generate with AI';
  }
}

function renderAIResultCards(data, fieldMeta, cardsEl) {
  cardsEl.innerHTML = '';
  fieldMeta.forEach(f => {
    const value = data[f.key];
    if (!value) return;
    const card = document.createElement('div');
    card.className = 'ai-result-card';
    card.innerHTML = `
      <div class="ai-result-card-header">
        <span class="ai-result-card-label">${f.label}</span>
        <button class="btn-apply-field" data-field="${f.key}">Apply →</button>
      </div>
      <div class="ai-result-card-body">${esc(value)}</div>`;
    card.querySelector('.btn-apply-field').addEventListener('click', () => applyAIField(f, value));
    cardsEl.appendChild(card);
  });
}

function applyAIField(fieldMeta, value) {
  const el = document.getElementById(fieldMeta.inputId);
  if (el) {
    el.value = value;
    el.style.borderColor = 'var(--green)';
    setTimeout(() => el.style.borderColor = '', 1000);
  }
}

function applyAllAI(fieldMeta, data) {
  fieldMeta.forEach(f => { if (data[f.key]) applyAIField(f, data[f.key]); });
}

async function checkApiKeyStatus() {
  try {
    const res = await fetch('/api/settings/api-key-status');
    const { configured } = await res.json();
    ['ai-key-warning', 'land-ai-key-warning'].forEach(id => {
      document.getElementById(id).classList.toggle('hidden', configured);
    });
  } catch {}
}

// ── Lands Data ────────────────────────────────────────────────
async function loadLands() {
  try {
    const res = await fetch(LANDS_API);
    lands = await res.json();
    renderLands();
  } catch (err) { console.error('Load lands error:', err); }
}

async function saveLand(data) {
  if (landEditorMode === 'edit' && landEditorId) {
    const res = await fetch(`${LANDS_API}/${landEditorId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!res.ok) throw new Error('Update failed');
    return res.json();
  }
  const res = await fetch(LANDS_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  if (!res.ok) throw new Error('Create failed');
  return res.json();
}

// ── Lands Catalog ─────────────────────────────────────────────
function bindLands() {
  document.getElementById('btn-lands-tile-view').addEventListener('click', () => setLandsDisplayMode('tile'));
  document.getElementById('btn-lands-list-view').addEventListener('click', () => setLandsDisplayMode('list'));
  document.getElementById('lands-new-btn').addEventListener('click', () => openLandEditorView('create'));
  document.getElementById('lands-empty-new-btn').addEventListener('click', () => openLandEditorView('create'));
  document.getElementById('lands-export-btn').addEventListener('click', exportLandsToExcel);
}

function setLandsDisplayMode(mode) {
  landsDisplayMode = mode;
  document.getElementById('btn-lands-tile-view').classList.toggle('active', mode === 'tile');
  document.getElementById('btn-lands-list-view').classList.toggle('active', mode === 'list');
  document.getElementById('lands-tile-view').classList.toggle('hidden', mode !== 'tile');
  document.getElementById('lands-list-view').classList.toggle('hidden', mode !== 'list');
}

function renderLands() {
  const n = lands.length;
  document.getElementById('lands-count').textContent = `${n} land${n !== 1 ? 's' : ''}`;
  renderLandsTileView();
  renderLandsListView();
  // Eagerly load products if any land has product_skus — so tile thumbnails appear automatically
  if (!productsLoaded && lands.some(l => l.product_skus && l.product_skus.length)) {
    loadProducts().then(() => renderLandsTileView()).catch(() => {});
  }
}

function renderLandsTileView() {
  const grid = document.getElementById('lands-tile-view');
  const empty = document.getElementById('lands-empty');
  Array.from(grid.children).forEach(el => { if (el.id !== 'lands-empty') el.remove(); });
  if (!lands.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  lands.forEach(land => grid.appendChild(buildLandTile(land)));
}

function renderLandsListView() {
  const tbody = document.getElementById('lands-list-body');
  const empty = document.getElementById('lands-list-empty');
  tbody.innerHTML = '';
  if (!lands.length) { empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  lands.forEach(land => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><div class="list-char-name">${esc(land.name)}</div></td>
      <td><span class="list-meta">${esc(land.visual_style ? land.visual_style.substring(0, 60) + (land.visual_style.length > 60 ? '…' : '') : '—')}</span></td>
      <td><span class="status-badge status-${land.status}">${cap(land.status)}</span></td>
      <td><span class="list-meta">${fmtDate(land.created_at)}</span></td>
      <td style="text-align:right"><button class="btn-secondary" style="font-size:11px;padding:4px 10px">View →</button></td>
    `;
    tr.addEventListener('click', () => openLandDetailModal(land.id));
    tbody.appendChild(tr);
  });
}

function buildLandTile(land) {
  const tile = document.createElement('div');
  tile.className = 'character-tile land-tile';

  // Hero image area — matches character tile structure
  const imgHtml = (land.images && land.images.length)
    ? `<img src="${esc(land.images[0])}" alt="${esc(land.name)}" loading="lazy" />`
    : `<div class="tile-image-placeholder">🌍</div>`;

  // Description snippet
  const descHtml = land.description
    ? `<div class="land-tile-desc">${esc(land.description.substring(0, 180))}${land.description.length > 180 ? '…' : ''}</div>`
    : '';

  // Product family thumbnails (up to 6, larger)
  const skus = land.product_skus || [];
  let pfHtml = '';
  if (skus.length) {
    const thumbs = skus.slice(0, 6).map(sku => {
      const p = productsLoaded ? allProducts.find(pr => pr.sku === sku) : null;
      return p && p.image_url
        ? `<img src="${esc(p.image_url)}" class="land-tile-pf-thumb" title="${esc(p.name || sku)}" loading="lazy" />`
        : `<div class="land-tile-pf-placeholder" title="${esc(sku)}"></div>`;
    }).join('');
    const more = skus.length > 6 ? `<div class="land-tile-pf-more">+${skus.length - 6}</div>` : '';
    pfHtml = `
      <div class="land-tile-pf">
        <div class="land-tile-pf-label">Product Family · ${skus.length} SKU${skus.length !== 1 ? 's' : ''}</div>
        <div class="land-tile-pf-thumbs">${thumbs}${more}</div>
      </div>`;
  }

  tile.innerHTML = `
    <div class="land-tile-image">${imgHtml}<span class="tile-status-badge status-badge status-${land.status}">${cap(land.status)}</span></div>
    <div class="land-tile-body">
      <div class="tile-name">${esc(land.name)}</div>
      ${descHtml}
      ${pfHtml}
    </div>`;
  tile.addEventListener('click', () => openLandDetailModal(land.id));
  return tile;
}

// ── Land Editor ───────────────────────────────────────────────
function openLandEditorView(mode, landId = null) {
  landEditorMode = mode;
  landEditorId = landId;
  landAiGeneratedData = {};
  landAiImageFile = null;
  pendingLandImages = [];
  pendingLandGenUrls = [];
  landGenImageUrl = null;
  document.getElementById('land-gen-preview-wrap')?.classList.add('hidden');
  document.getElementById('land-gen-status')?.classList.add('hidden');
  clearLandAIPanel();

  if (mode === 'edit' && landId) {
    const land = lands.find(l => l.id === landId);
    if (!land) return;
    document.getElementById('land-editor-title').textContent = land.name;
    LAND_FIELD_META.forEach(f => { const el = document.getElementById(f.inputId); if (el) el.value = land[f.key] || ''; });
    document.getElementById('fl-status').value = land.status || 'active';
    renderLandEditorImages(land.images || []);
    // Restore permanently-saved product SKUs (clearLandAIPanel already ran above)
    if (land.product_skus && land.product_skus.length) {
      restoreLandProductSelection(land.product_skus);
    }
  } else {
    document.getElementById('land-editor-title').textContent = 'New Land';
    LAND_FIELD_META.forEach(f => { const el = document.getElementById(f.inputId); if (el) el.value = ''; });
    document.getElementById('fl-status').value = 'active';
    renderLandEditorImages([]);
  }

  document.getElementById('land-editor-save-status').textContent = '';
  switchLandEditorTab('land-profile');
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-land-editor').classList.add('active');
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  currentView = 'land-editor';
  window.scrollTo(0, 0);
}

function renderLandEditorImages(existingUrls) {
  const gallery = document.getElementById('land-editor-images-gallery');
  gallery.innerHTML = '';
  // Prepend any accepted generated URLs (already on server) so they show first
  const allUrls = [...pendingLandGenUrls, ...existingUrls.filter(u => !pendingLandGenUrls.includes(u))];
  allUrls.forEach((url, idx) => {
    const item = document.createElement('div');
    item.className = 'editor-image-item';
    const isGen = pendingLandGenUrls.includes(url);
    item.innerHTML = `
      <img src="${esc(url)}" alt="Image ${idx + 1}" loading="lazy" />
      ${idx === 0 ? '<span class="img-primary-badge">Primary</span>' : ''}
      ${isGen ? '<span class="img-gen-badge">✨ Generated</span>' : ''}
      <button class="img-remove-btn" title="Remove image" aria-label="Remove">✕</button>`;
    item.querySelector('.img-remove-btn').addEventListener('click', () => {
      if (isGen) {
        pendingLandGenUrls = pendingLandGenUrls.filter(u => u !== url);
        renderLandEditorImages(existingUrls);
      } else {
        handleLandImageRemove(existingUrls.indexOf(url));
      }
    });
    gallery.appendChild(item);
  });
  pendingLandImages.forEach((file, idx) => {
    const item = document.createElement('div');
    item.className = 'editor-image-pending';
    const img = document.createElement('img');
    img.alt = 'Pending upload';
    const reader = new FileReader();
    reader.onload = e => { img.src = e.target.result; };
    reader.readAsDataURL(file);
    const removeBtn = document.createElement('button');
    removeBtn.className = 'img-remove-btn';
    removeBtn.title = 'Remove';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => {
      pendingLandImages.splice(idx, 1);
      const land = landEditorMode === 'edit' ? lands.find(l => l.id === landEditorId) : null;
      renderLandEditorImages(land ? land.images || [] : []);
    });
    item.appendChild(img);
    item.appendChild(removeBtn);
    gallery.appendChild(item);
  });
}

async function handleLandImageRemove(idx) {
  if (landEditorMode === 'edit' && landEditorId) {
    try {
      const res = await fetch(`${LANDS_API}/${landEditorId}/images/${idx}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Remove failed');
      const updated = await res.json();
      lands = lands.map(l => l.id === updated.id ? updated : l);
      renderLandEditorImages(updated.images || []);
      renderLands();
    } catch (err) { alert('Could not remove image: ' + err.message); }
  }
}

function bindLandEditor() {
  document.querySelectorAll('#view-land-editor .editor-tab').forEach(btn => {
    btn.addEventListener('click', () => switchLandEditorTab(btn.dataset.tab));
  });
  document.getElementById('land-editor-back-btn').addEventListener('click', () => goBack('lands'));
  document.getElementById('land-editor-cancel-btn').addEventListener('click', () => goBack('lands'));
  document.getElementById('land-editor-save-btn').addEventListener('click', handleLandEditorSave);
  document.getElementById('land-editor-image-upload').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    if (landEditorMode === 'edit' && landEditorId) {
      const btn = document.getElementById('land-editor-save-btn');
      btn.disabled = true;
      const prevText = btn.textContent;
      btn.textContent = 'Uploading…';
      try {
        let updated;
        for (const file of files) {
          const fd = new FormData();
          fd.append('image', file);
          const res = await fetch(`${LANDS_API}/${landEditorId}/images`, { method: 'POST', body: fd });
          if (!res.ok) throw new Error('Upload failed');
          updated = await res.json();
        }
        lands = lands.map(l => l.id === updated.id ? updated : l);
        renderLandEditorImages(updated.images || []);
        renderLands();
      } catch (err) { alert('Upload failed: ' + err.message); }
      finally { btn.disabled = false; btn.textContent = prevText; }
    } else {
      pendingLandImages.push(...files);
      renderLandEditorImages([]);
    }
    e.target.value = '';
  });
}

async function handleLandEditorSave() {
  const data = {};
  LAND_FIELD_META.forEach(f => { const el = document.getElementById(f.inputId); if (el) data[f.key] = el.value.trim(); });
  data.status = document.getElementById('fl-status').value;
  data.product_skus = [...selectedProductSkus];  // persist associated SKUs

  if (!data.name) {
    const el = document.getElementById('fl-name');
    el.focus(); el.style.borderColor = 'var(--coral)';
    setTimeout(() => el.style.borderColor = '', 1500);
    return;
  }

  const btn = document.getElementById('land-editor-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    let saved = await saveLand(data);
    const toUpload = [];
    if (landAiImageFile && (landEditorMode === 'create' || !saved.images || saved.images.length === 0)) {
      toUpload.push(landAiImageFile);
    }
    toUpload.push(...pendingLandImages);

    if (toUpload.length) {
      btn.textContent = 'Uploading images…';
      for (const file of toUpload) {
        const fd = new FormData();
        fd.append('image', file);
        const imgRes = await fetch(`${LANDS_API}/${saved.id}/images`, { method: 'POST', body: fd });
        if (imgRes.ok) saved = await imgRes.json();
      }
    }
    pendingLandImages = [];

    // Include any accepted AI-generated image URLs (already on server)
    if (pendingLandGenUrls.length) {
      const mergedImages = [...pendingLandGenUrls, ...(saved.images || []).filter(u => !pendingLandGenUrls.includes(u))];
      const updRes = await fetch(`${LANDS_API}/${saved.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: mergedImages }),
      });
      if (updRes.ok) saved = await updRes.json();
      pendingLandGenUrls = [];
    }

    if (landEditorMode === 'edit') {
      lands = lands.map(l => l.id === saved.id ? saved : l);
    } else {
      lands.unshift(saved);
    }
    renderLands();
    document.getElementById('land-editor-save-status').textContent = '✓ Saved';
    setTimeout(() => { switchView('lands'); }, 600);
  } catch (err) {
    alert('Save failed: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Save Land';
  }
}

// ── Land AI Panel ─────────────────────────────────────────────
function bindLandAIPanel() {
  const zone = document.getElementById('land-ai-image-zone');
  const input = document.getElementById('land-ai-image-input');
  const clearBtn = document.getElementById('land-ai-image-clear');

  zone.addEventListener('click', (e) => { if (e.target === clearBtn || clearBtn.contains(e.target)) return; input.click(); });
  input.addEventListener('change', () => { if (input.files[0]) setAIImage(input.files[0], 'land'); });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('drag-over'); const f = e.dataTransfer.files[0]; if (f && f.type.startsWith('image/')) setAIImage(f, 'land'); });
  clearBtn.addEventListener('click', (e) => { e.stopPropagation(); clearAIImage('land'); });

  document.getElementById('land-ai-generate-btn').addEventListener('click', handleLandAIGenerate);
  document.getElementById('land-ai-apply-all-btn').addEventListener('click', () => applyAllAI(LAND_FIELD_META, landAiGeneratedData));
  document.getElementById('land-ai-goto-settings').addEventListener('click', (e) => { e.preventDefault(); switchView('settings'); loadSettings(); });

  // Story Builder → Land Products tab shortcuts
  document.getElementById('land-sb-goto-products-btn').addEventListener('click', () => switchLandEditorTab('land-products'));
  document.getElementById('land-sb-edit-products-btn').addEventListener('click', () => switchLandEditorTab('land-products'));
}

function clearLandAIPanel() {
  clearAIImage('land');
  clearLandProductSelection();
  document.getElementById('land-ai-description').value = '';
  document.getElementById('land-ai-results').classList.add('hidden');
  document.getElementById('land-ai-result-cards').innerHTML = '';
}

// ── Character product selection ───────────────────────────────
function renderCharProductSelection() {
  const n = charSelectedProducts.length;
  const emptyEl  = document.getElementById('char-editor-pf-empty');
  const scrollEl = document.getElementById('char-editor-pf-scroll');
  const cardsEl  = document.getElementById('char-editor-pf-cards');
  const countEl  = document.getElementById('char-editor-pf-count');
  if (!emptyEl) return;

  if (!n) {
    emptyEl.classList.remove('hidden');
    scrollEl.classList.add('hidden');
    if (countEl) countEl.classList.add('hidden');
    return;
  }
  emptyEl.classList.add('hidden');
  scrollEl.classList.remove('hidden');
  if (countEl) { countEl.textContent = `${n} SKU${n !== 1 ? 's' : ''} selected`; countEl.classList.remove('hidden'); }

  cardsEl.innerHTML = '';
  charSelectedProducts.forEach(p => {
    const card = document.createElement('div');
    card.className = 'land-pf-card land-editor-pf-card';
    card.innerHTML = p.image_url
      ? `<div class="land-pf-card-img-wrap"><img src="${esc(p.image_url)}" alt="${esc(p.name || p.sku)}" class="land-pf-card-img" loading="lazy" /></div>
         <div class="land-pf-card-body">${buildProductCardBody(p)}</div>`
      : `<div class="land-pf-card-img-wrap land-pf-card-img-empty"><span class="land-pf-card-img-icon">📦</span></div>
         <div class="land-pf-card-body">${buildProductCardBody(p)}</div>`;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'pf-card-remove';
    removeBtn.title = 'Remove';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', e => {
      e.stopPropagation();
      charSelectedProductSkus.delete(p.sku);
      charSelectedProducts = charSelectedProducts.filter(x => x.sku !== p.sku);
      renderCharProductSelection();
    });
    card.appendChild(removeBtn);
    cardsEl.appendChild(card);
  });
}

function clearCharProductSelection() {
  charSelectedProductSkus = new Set();
  charSelectedProducts = [];
  renderCharProductSelection();
}

function restoreCharProductSelection(skus) {
  charSelectedProductSkus = new Set(skus);
  if (productsLoaded) {
    charSelectedProducts = skus.map(sku => allProducts.find(p => p.sku === sku) || { sku, name: sku, image_url: '' });
    renderCharProductSelection();
  } else {
    charSelectedProducts = skus.map(sku => ({ sku, name: sku, image_url: '' }));
    renderCharProductSelection();
    loadProducts().then(() => {
      if (charSelectedProductSkus.size) {
        charSelectedProducts = [...charSelectedProductSkus].map(sku => allProducts.find(p => p.sku === sku) || { sku, name: sku, image_url: '' });
        renderCharProductSelection();
      }
    }).catch(() => {});
  }
}

function renderCharDetailProducts(char) {
  const section   = document.getElementById('char-detail-products-section');
  const container = document.getElementById('char-detail-products');
  const countEl   = document.getElementById('char-pf-count');
  const skus = char.product_skus || [];
  if (!skus.length) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  if (countEl) countEl.textContent = `${skus.length} SKU${skus.length !== 1 ? 's' : ''}`;
  container.innerHTML = '';
  skus.forEach(sku => {
    const product = (productsLoaded && Array.isArray(allProducts)) ? allProducts.find(p => p.sku === sku) : null;
    const p = product || { sku, name: sku, image_url: '' };
    const card = document.createElement('div');
    card.className = 'land-pf-card';
    card.innerHTML = p.image_url
      ? `<div class="land-pf-card-img-wrap"><img src="${esc(p.image_url)}" alt="${esc(p.name)}" class="land-pf-card-img" loading="lazy" /></div>
         <div class="land-pf-card-body">${buildProductCardBody(p)}</div>`
      : `<div class="land-pf-card-img-wrap land-pf-card-img-empty"><span class="land-pf-card-img-icon">📦</span></div>
         <div class="land-pf-card-body"><div class="land-pf-card-name">${esc(sku)}</div><div class="land-pf-card-sku">${product ? product.name : 'Loading…'}</div></div>`;
    container.appendChild(card);
  });
}

function clearLandProductSelection() {
  landSelectedProducts = [];
  landAiProductImageUrls = [];
  selectedProductSkus = new Set();
  renderLandProductSelection();
}

function restoreLandProductSelection(skus) {
  selectedProductSkus = new Set(skus);
  if (productsLoaded) {
    landSelectedProducts = skus.map(sku => allProducts.find(p => p.sku === sku) || { sku, name: sku, image_url: '' });
    landAiProductImageUrls = landSelectedProducts.filter(p => p.image_url).map(p => p.image_url);
    renderLandProductSelection();
  } else {
    // Show SKU badges immediately; upgrade to thumbnails once catalog loads
    landSelectedProducts = skus.map(sku => ({ sku, name: sku, image_url: '' }));
    landAiProductImageUrls = [];
    renderLandProductSelection();
    loadProducts().then(() => {
      if (selectedProductSkus.size) {   // still relevant — editor is still open
        landSelectedProducts = [...selectedProductSkus].map(sku => allProducts.find(p => p.sku === sku) || { sku, name: sku, image_url: '' });
        landAiProductImageUrls = landSelectedProducts.filter(p => p.image_url).map(p => p.image_url);
        renderLandProductSelection();
      }
    }).catch(() => {});
  }
}

async function handleLandAIGenerate() {
  const description = document.getElementById('land-ai-description').value.trim();
  const hasInput = landAiImageFile || landAiProductImageUrls.length || description;
  if (!hasInput) { document.getElementById('land-ai-description').focus(); return; }
  await runAIGenerate({
    endpoint: '/api/ai/generate-land',
    imageFile: landAiImageFile,
    imageUrls: landAiProductImageUrls,
    description,
    fieldMeta: LAND_FIELD_META,
    generateBtnId: 'land-ai-generate-btn',
    resultsId: 'land-ai-results',
    cardsId: 'land-ai-result-cards',
    storeIn: (data) => { landAiGeneratedData = data; },
  });
}

// ── Character Detail Modal ────────────────────────────────────
function bindDetailModal() {
  document.getElementById('detail-close-btn').addEventListener('click', closeDetailModal);
  document.getElementById('detail-close-btn2').addEventListener('click', closeDetailModal);
  document.getElementById('detail-delete-btn').addEventListener('click', handleDeleteChar);
  document.getElementById('detail-edit-btn').addEventListener('click', () => { const id = activeDetailId; closeDetailModal(); openEditorView('edit', id); });
  document.getElementById('modal-detail').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeDetailModal(); });
}

function openDetailModal(id) {
  console.log('[modal] openDetailModal called, id=', id, 'chars loaded=', characters.length);
  try {
  // Coerce both sides to string — guards against integer vs string type mismatch
  const char = characters.find(c => String(c.id) === String(id));
  if (!char) { console.warn('[modal] char not found for id=', id); return; }
  activeDetailId = id;

  document.getElementById('detail-name').textContent = char.name;
  document.getElementById('detail-meta').textContent = [char.species, char.role].filter(Boolean).join(' · ');
  ['backstory','personality','key_passions','what_they_care_about','tone_and_voice','hook_and_audience','first_appeared'].forEach(f => {
    const el = document.getElementById(`detail-${f.replace(/_/g,'-')}`);
    if (el) el.textContent = char[f] || '—';   // null-safe: element may not exist in cached HTML
  });
  document.getElementById('detail-status').innerHTML = `<span class="status-badge status-${char.status}">${cap(char.status)}</span>`;

  renderDetailImages(char);
  renderCharDetailProducts(char);
  document.getElementById('modal-detail').classList.remove('hidden');
  console.log('[modal] modal shown for', char.name);

  const skus = char.product_skus || [];
  if (skus.length && !productsLoaded) {
    loadProducts().then(() => {
      if (activeDetailId === id) renderCharDetailProducts(char);
    }).catch(() => {});
  }
  } catch (err) {
    console.error('[modal] openDetailModal error:', err);
  }
}

function renderDetailImages(char) {
  const imgEl = document.getElementById('detail-images');
  if (!imgEl) return;
  if (char.images && char.images.length) {
    imgEl.innerHTML = char.images.map((src, idx) => `
      <div class="char-detail-img-wrap ${idx === 0 ? 'char-detail-img-primary' : ''}">
        <img src="${esc(src)}" alt="${esc(char.name)}" />
        ${idx === 0 ? '<span class="char-detail-img-badge">Primary</span>' : ''}
      </div>`).join('');
  } else {
    imgEl.innerHTML = `<div class="char-detail-no-images"><span>🖼</span><span>No images — add them in the Character Artwork tab</span></div>`;
  }
}

function closeDetailModal() {
  document.getElementById('modal-detail').classList.add('hidden');
  activeDetailId = null;
}

async function handleDeleteChar() {
  const char = characters.find(c => c.id === activeDetailId);
  if (!char || !confirm(`Delete "${char.name}"? This cannot be undone.`)) return;
  try {
    await fetch(`${API}/${activeDetailId}`, { method: 'DELETE' });
    characters = characters.filter(c => c.id !== activeDetailId);
    closeDetailModal();
    renderCatalog();
  } catch (err) { alert('Delete failed: ' + err.message); }
}

// ── Land Detail Modal ─────────────────────────────────────────
function bindLandDetailModal() {
  document.getElementById('land-detail-close-btn').addEventListener('click', closeLandDetailModal);
  document.getElementById('land-detail-close-btn2').addEventListener('click', closeLandDetailModal);
  document.getElementById('land-detail-delete-btn').addEventListener('click', handleDeleteLand);
  document.getElementById('land-detail-edit-btn').addEventListener('click', () => { const id = activeLandDetailId; closeLandDetailModal(); openLandEditorView('edit', id); });
  document.getElementById('modal-land-detail').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeLandDetailModal(); });
  document.getElementById('land-detail-image-upload').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !activeLandDetailId) return;
    try {
      let updated;
      for (const file of files) {
        const fd = new FormData();
        fd.append('image', file);
        const res = await fetch(`${LANDS_API}/${activeLandDetailId}/images`, { method: 'POST', body: fd });
        if (!res.ok) throw new Error('Upload failed');
        updated = await res.json();
      }
      lands = lands.map(l => l.id === updated.id ? updated : l);
      renderLandDetailImages(updated);
      renderLands();
    } catch (err) { alert('Upload failed: ' + err.message); }
    e.target.value = '';
  });
}

function openLandDetailModal(id) {
  const land = lands.find(l => l.id === id);
  if (!land) return;
  activeLandDetailId = id;

  document.getElementById('land-detail-name').textContent = land.name;
  document.getElementById('land-detail-meta').textContent = land.visual_style ? land.visual_style.substring(0, 80) : '';
  ['description','visual_style','color_palette','themes_and_content'].forEach(f => {
    document.getElementById(`land-detail-${f.replace(/_/g,'-')}`).textContent = land[f] || '—';
  });
  document.getElementById('land-detail-status').innerHTML = `<span class="status-badge status-${land.status}">${cap(land.status)}</span>`;

  renderLandDetailImages(land);
  renderLandDetailProducts(land);
  document.getElementById('modal-land-detail').classList.remove('hidden');

  // If this land has SKUs but products aren't loaded yet, load them and re-render the product section
  const skus = land.product_skus || [];
  if (skus.length && !productsLoaded) {
    loadProducts().then(() => {
      // Make sure the modal is still open for this same land before re-rendering
      if (activeLandDetailId === id) renderLandDetailProducts(land);
    }).catch(() => {});
  }
}

function renderLandDetailProducts(land) {
  const section = document.getElementById('land-detail-products-section');
  const container = document.getElementById('land-detail-products');
  const countEl = document.getElementById('land-pf-count');
  const skus = land.product_skus || [];
  if (!skus.length) { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');
  if (countEl) countEl.textContent = `${skus.length} SKU${skus.length !== 1 ? 's' : ''}`;
  container.innerHTML = '';
  skus.forEach(sku => {
    const product = (productsLoaded && Array.isArray(allProducts)) ? allProducts.find(p => p.sku === sku) : null;
    const card = document.createElement('div');
    card.className = 'land-pf-card';
    if (product && product.image_url) {
      const metaHtml = [
        product.t12m_revenue != null  ? `<span>$${Number(product.t12m_revenue).toLocaleString()}</span>` : '',
        product.t12m_units   != null  ? `<span>${Number(product.t12m_units).toLocaleString()} units</span>` : '',
      ].filter(Boolean).join('<span class="land-pf-card-sep">·</span>');
      card.innerHTML = `
        <div class="land-pf-card-img-wrap">
          <img src="${esc(product.image_url)}" alt="${esc(product.name)}" class="land-pf-card-img" loading="lazy" />
        </div>
        <div class="land-pf-card-body">
          <div class="land-pf-card-name">${esc(product.name)}</div>
          <div class="land-pf-card-sku">${esc(sku)}</div>
          ${metaHtml ? `<div class="land-pf-card-meta">${metaHtml}</div>` : ''}
        </div>`;
    } else {
      card.innerHTML = `
        <div class="land-pf-card-img-wrap land-pf-card-img-empty">
          <span class="land-pf-card-img-icon">📦</span>
        </div>
        <div class="land-pf-card-body">
          <div class="land-pf-card-name">${esc(sku)}</div>
          <div class="land-pf-card-sku">Loading…</div>
        </div>`;
    }
    container.appendChild(card);
  });
}

function renderLandDetailImages(land) {
  const imgEl = document.getElementById('land-detail-images');
  if (land.images && land.images.length) {
    imgEl.innerHTML = '';
    land.images.forEach((src, idx) => {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:relative;';
      wrapper.innerHTML = `<img src="${esc(src)}" alt="${esc(land.name)}" style="cursor:default" />
        <button style="position:absolute;top:3px;right:3px;width:20px;height:20px;border-radius:50%;border:none;background:rgba(214,59,47,.8);color:#fff;cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center;padding:0" title="Remove image">✕</button>`;
      wrapper.querySelector('button').addEventListener('click', async () => {
        try {
          const res = await fetch(`${LANDS_API}/${land.id}/images/${idx}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('Remove failed');
          const updated = await res.json();
          lands = lands.map(l => l.id === updated.id ? updated : l);
          renderLandDetailImages(updated);
          renderLands();
        } catch (err) { alert('Could not remove: ' + err.message); }
      });
      imgEl.appendChild(wrapper);
    });
  } else {
    imgEl.innerHTML = `<div class="image-placeholder"><div class="image-placeholder-icon">🖼</div><div class="image-placeholder-text">No images yet</div></div>`;
  }
}

function closeLandDetailModal() {
  document.getElementById('modal-land-detail').classList.add('hidden');
  activeLandDetailId = null;
}

async function handleDeleteLand() {
  const land = lands.find(l => l.id === activeLandDetailId);
  if (!land || !confirm(`Delete "${land.name}"? This cannot be undone.`)) return;
  try {
    await fetch(`${LANDS_API}/${activeLandDetailId}`, { method: 'DELETE' });
    lands = lands.filter(l => l.id !== activeLandDetailId);
    closeLandDetailModal();
    renderLands();
  } catch (err) { alert('Delete failed: ' + err.message); }
}

// ── Settings ──────────────────────────────────────────────────
function bindSettings() {
  document.getElementById('settings-save-btn').addEventListener('click', handleSettingsSave);
  document.getElementById('settings-export-btn').addEventListener('click', exportSettingsToExcel);

  // Snowflake: Test Connection
  document.getElementById('sf-test-btn').addEventListener('click', async () => {
    const btn = document.getElementById('sf-test-btn');
    const bar = document.getElementById('snowflake-status-bar');
    btn.disabled = true; btn.textContent = 'Testing…';
    bar.className = 'snowflake-status-bar'; bar.textContent = ''; bar.classList.remove('hidden');
    try {
      // Save current creds first so snowflake.js picks them up
      await saveSnowflakeCredentials();
      const res = await fetch('/api/sales/test', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        bar.classList.add('sf-status-ok'); bar.textContent = '✓ Connection successful';
      } else {
        bar.classList.add('sf-status-err'); bar.textContent = '✗ ' + (data.error || 'Connection failed');
      }
    } catch (err) {
      bar.classList.add('sf-status-err'); bar.textContent = '✗ ' + err.message;
    } finally {
      btn.disabled = false; btn.textContent = 'Test Connection';
    }
  });

  // Snowflake: Sync Sales Data
  document.getElementById('sf-refresh-btn').addEventListener('click', async () => {
    const btn = document.getElementById('sf-refresh-btn');
    const bar = document.getElementById('snowflake-status-bar');
    btn.disabled = true; btn.textContent = 'Syncing…';
    bar.className = 'snowflake-status-bar'; bar.textContent = ''; bar.classList.remove('hidden');
    try {
      await saveSnowflakeCredentials();
      const res = await fetch('/api/sales/refresh', { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        bar.classList.add('sf-status-ok');
        bar.textContent = `✓ Synced ${data.count} SKUs`;
        await loadSalesData(); // refresh in-memory cache
        updateSfLastSync(data.last_refresh);
      } else {
        bar.classList.add('sf-status-err'); bar.textContent = '✗ ' + (data.error || 'Sync failed');
      }
    } catch (err) {
      bar.classList.add('sf-status-err'); bar.textContent = '✗ ' + err.message;
    } finally {
      btn.disabled = false; btn.textContent = 'Sync Sales Data';
    }
  });

  // Box: Test Connection
  document.getElementById('box-test-btn')?.addEventListener('click', async () => {
    const bar = document.getElementById('box-status-bar');
    bar.classList.remove('hidden');
    bar.textContent = '⏳ Testing Box connection…';
    try {
      const res = await fetch('/api/asset-library/box/test');
      const data = await res.json();
      bar.textContent = data.ok ? `✅ ${data.message}` : `❌ ${data.message}`;
    } catch (e) { bar.textContent = `❌ ${e.message}`; }
  });

  // Image sample upload
  document.getElementById('img-samples-upload').addEventListener('change', (e) => {
    if (e.target.files.length) uploadImageSamples(Array.from(e.target.files));
    e.target.value = '';
  });

  // Collapsible section toggles
  document.querySelectorAll('.settings-section-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.closest('.settings-section');
      section.classList.toggle('collapsed');
      // Sync nav active state
      const id = section.id;
      if (!section.classList.contains('collapsed')) setSettingsNavActive(id);
    });
  });

  // Left nav click — expand target section, scroll to it
  document.querySelectorAll('.settings-nav-item').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const id = link.dataset.section;
      const section = document.getElementById(id);
      if (!section) return;
      section.classList.remove('collapsed');
      setSettingsNavActive(id);
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  // Highlight nav item as user scrolls sections into view
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) setSettingsNavActive(entry.target.id);
    });
  }, { rootMargin: '-20% 0px -60% 0px', threshold: 0 });
  document.querySelectorAll('.settings-section').forEach(s => observer.observe(s));
}

function setSettingsNavActive(id) {
  document.querySelectorAll('.settings-nav-item').forEach(link => {
    link.classList.toggle('active', link.dataset.section === id);
  });
}

// ── Character Artwork Generator ───────────────────────────────
let charArtRefFiles = [];    // File[] — uploaded reference images
let charArtGenUrl   = null;  // URL of most recently generated artwork

function bindCharArtGenerator() {
  const zone    = document.getElementById('char-art-upload-zone');
  const input   = document.getElementById('char-art-upload-input');
  const link    = document.getElementById('char-art-upload-link');
  const placeholder = document.getElementById('char-art-upload-placeholder');

  // Click anywhere in zone (or on link) to open file picker
  zone.addEventListener('click', (e) => {
    if (e.target.classList.contains('char-art-ref-remove')) return;
    if (e.target.classList.contains('char-art-ref-add')) return;
    input.click();
  });
  if (link) link.addEventListener('click', (e) => { e.stopPropagation(); input.click(); });

  input.addEventListener('change', () => {
    addCharArtRefs(Array.from(input.files));
    input.value = '';
  });

  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault(); zone.classList.remove('drag-over');
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
    if (files.length) addCharArtRefs(files);
  });

  document.getElementById('char-art-generate-btn').addEventListener('click', generateCharArt);
  document.getElementById('char-art-accept-btn').addEventListener('click', acceptCharArt);
  document.getElementById('char-art-regen-btn').addEventListener('click', generateCharArt);
  document.getElementById('char-art-discard-btn').addEventListener('click', discardCharArt);
  document.getElementById('char-art-goto-settings').addEventListener('click', (e) => {
    e.preventDefault(); switchView('settings'); loadSettings();
  });
  document.getElementById('char-art-preview-img').addEventListener('click', () => {
    document.getElementById('char-art-prompt-peek').classList.toggle('hidden');
  });
}

function addCharArtRefs(files) {
  const remaining = 4 - charArtRefFiles.length;
  const toAdd = files.slice(0, remaining);
  charArtRefFiles.push(...toAdd);
  renderCharArtRefs();
  renderSourceGallery();
}

function renderCharArtRefs() {
  const strip       = document.getElementById('char-art-preview-strip');
  const placeholder = document.getElementById('char-art-upload-placeholder');
  const input       = document.getElementById('char-art-upload-input');

  if (!charArtRefFiles.length) {
    strip.classList.add('hidden');
    placeholder.classList.remove('hidden');
    return;
  }

  strip.classList.remove('hidden');
  placeholder.classList.add('hidden');
  strip.innerHTML = '';

  charArtRefFiles.forEach((file, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'char-art-ref-thumb-wrap';
    const img = document.createElement('img');
    img.className = 'char-art-ref-thumb';
    img.alt = `Ref ${idx + 1}`;
    const reader = new FileReader();
    reader.onload = e => { img.src = e.target.result; };
    reader.readAsDataURL(file);
    const removeBtn = document.createElement('button');
    removeBtn.className = 'char-art-ref-remove';
    removeBtn.title = 'Remove';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      charArtRefFiles.splice(idx, 1);
      renderCharArtRefs();
      renderSourceGallery();
    });
    wrap.appendChild(img);
    wrap.appendChild(removeBtn);
    strip.appendChild(wrap);
  });

  // Add "+" button if under limit
  if (charArtRefFiles.length < 4) {
    const addBtn = document.createElement('button');
    addBtn.className = 'char-art-ref-add';
    addBtn.title = 'Add another reference image';
    addBtn.textContent = '+';
    addBtn.addEventListener('click', (e) => { e.stopPropagation(); input.click(); });
    strip.appendChild(addBtn);
  }
}

async function generateCharArt() {
  const btn    = document.getElementById('char-art-generate-btn');
  const status = document.getElementById('char-art-status');
  const warn   = document.getElementById('char-art-openai-warning');
  const preview = document.getElementById('char-art-preview-wrap');
  const notes  = (document.getElementById('char-art-notes')?.value || '').trim();

  // Pull current form field values for context
  const name        = (document.getElementById('f-name')?.value || '').trim();
  const species     = (document.getElementById('f-species')?.value || '').trim();
  const role        = (document.getElementById('f-role')?.value || '').trim();
  const backstory   = (document.getElementById('f-backstory')?.value || '').trim();
  const personality = (document.getElementById('f-personality')?.value || '').trim();
  const key_passions    = (document.getElementById('f-key-passions')?.value || '').trim();
  const tone_and_voice    = (document.getElementById('f-tone-and-voice')?.value || '').trim();
  const hook_and_audience = (document.getElementById('f-hook-and-audience')?.value || '').trim();

  btn.disabled = true;
  preview.classList.add('hidden');
  warn.classList.add('hidden');
  status.classList.remove('hidden');
  status.innerHTML = '<span>⏳</span> Generating artwork… this takes about 15–30 seconds.';

  try {
    const fd = new FormData();
    charArtRefFiles.forEach(f => fd.append('images', f));
    fd.append('name', name);
    fd.append('species', species);
    fd.append('role', role);
    fd.append('backstory', backstory);
    fd.append('personality', personality);
    fd.append('key_passions', key_passions);
    fd.append('tone_and_voice', tone_and_voice);
    fd.append('hook_and_audience', hook_and_audience);
    fd.append('notes', notes);

    const res  = await fetch('/api/ai/generate-char-image', { method: 'POST', body: fd });
    const data = await res.json();

    if (!res.ok) {
      if (res.status === 400 && data.error?.toLowerCase().includes('openai')) {
        warn.classList.remove('hidden');
      } else {
        status.textContent = '✗ ' + (data.error || 'Generation failed');
      }
      return;
    }

    charArtGenUrl = data.image_url;
    document.getElementById('char-art-preview-img').src = data.image_url;
    document.getElementById('char-art-prompt-peek').textContent = '📝 Prompt: ' + data.dalle_prompt;
    status.classList.add('hidden');
    preview.classList.remove('hidden');

  } catch (err) {
    status.textContent = '✗ ' + err.message;
  } finally {
    btn.disabled = false;
  }
}

async function acceptCharArt() {
  if (!charArtGenUrl) return;
  if (editorMode === 'edit' && editorCharId) {
    try {
      const charData = await fetch(`/api/characters/${editorCharId}`).then(r => r.json());
      const newImages = [charArtGenUrl, ...(charData.images || []).filter(u => u !== charArtGenUrl)];
      const updated = await fetch(`/api/characters/${editorCharId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: newImages }),
      }).then(r => r.json());
      characters = characters.map(c => c.id === updated.id ? updated : c);
      renderApprovedGallery();
      renderSourceGallery();
      renderCatalog();
    } catch (e) { alert('Could not save artwork: ' + e.message); return; }
  } else {
    if (!pendingCharGenUrls.includes(charArtGenUrl)) pendingCharGenUrls.unshift(charArtGenUrl);
    renderApprovedGallery();
  }
  document.getElementById('char-art-preview-wrap').classList.add('hidden');
  charArtGenUrl = null;
}

function discardCharArt() {
  charArtGenUrl = null;
  document.getElementById('char-art-preview-wrap').classList.add('hidden');
  document.getElementById('char-art-status').classList.add('hidden');
}

// ── Land Headline Image Generator — event bindings ────────────
function bindLandImageGenerator() {
  document.getElementById('land-gen-image-btn').addEventListener('click', generateLandImage);
  document.getElementById('land-gen-accept-btn').addEventListener('click', acceptGeneratedImage);
  document.getElementById('land-gen-discard-btn').addEventListener('click', discardGeneratedImage);
  document.getElementById('land-gen-regen-btn').addEventListener('click', generateLandImage);
  document.getElementById('land-gen-goto-settings').addEventListener('click', (e) => {
    e.preventDefault(); switchView('settings'); loadSettings();
  });
  // Toggle DALL-E prompt on image click
  document.getElementById('land-gen-preview-img').addEventListener('click', () => {
    document.getElementById('land-gen-prompt-peek').classList.toggle('hidden');
  });
}

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    const s = await res.json();
    setVal('s-system-prompt', s.ai_system_prompt);
    setVal('s-model', s.ai_model);
    setVal('s-instruction-name', s.ai_instruction_name);
    setVal('s-instruction-species', s.ai_instruction_species);
    setVal('s-instruction-role', s.ai_instruction_role);
    setVal('s-instruction-backstory', s.ai_instruction_backstory);
    setVal('s-instruction-personality', s.ai_instruction_personality);
    setVal('s-instruction-key-passions', s.ai_instruction_key_passions);
    setVal('s-instruction-what-they-care-about', s.ai_instruction_what_they_care_about);
    setVal('s-instruction-tone-and-voice', s.ai_instruction_tone_and_voice);
    setVal('s-instruction-hook-and-audience', s.ai_instruction_hook_and_audience);
    setVal('s-quote-instructions', s.ai_quote_instructions);
    setVal('s-land-instruction-name', s.ai_land_instruction_name);
    setVal('s-land-instruction-description', s.ai_land_instruction_description);
    setVal('s-land-instruction-visual-style', s.ai_land_instruction_visual_style);
    setVal('s-land-instruction-color-palette', s.ai_land_instruction_color_palette);
    setVal('s-land-instruction-themes-and-content', s.ai_land_instruction_themes_and_content);
    setVal('s-image-gen-instructions', s.ai_image_gen_instructions);

    // Snowflake — only populate if values exist (don't overwrite env-var-sourced blanks)
    setVal('s-sf-account',   s.snowflake_account);
    setVal('s-sf-username',  s.snowflake_username);
    setVal('s-sf-warehouse', s.snowflake_warehouse);
    setVal('s-sf-database',  s.snowflake_database);
    setVal('s-sf-schema',    s.snowflake_schema);
    setVal('s-sf-role',      s.snowflake_role);
    setVal('s-sf-query',     s.snowflake_query);
    // Never pre-fill password field

    // Load sync status
    try {
      const sfStatus = await fetch('/api/sales/status').then(r => r.json());
      updateSfLastSync(sfStatus.last_refresh, sfStatus.sku_count);
    } catch { /* non-critical */ }

    const badge = document.getElementById('api-key-status-badge');
    badge.className = s.api_key_configured ? 'api-key-badge configured' : 'api-key-badge missing';
    badge.textContent = s.api_key_configured ? '✓ API Key Configured' : '✗ API Key Not Set';

    const oaiBadge = document.getElementById('openai-key-status-badge');
    oaiBadge.className = s.openai_key_configured ? 'api-key-badge configured' : 'api-key-badge missing';
    oaiBadge.textContent = s.openai_key_configured ? '✓ OpenAI Key Configured' : '✗ OpenAI Key Not Set';

    loadImageSamples();

    // Asset Library / Box settings
    document.getElementById('sf-box-client-id').value = s.box_client_id || '';
    document.getElementById('sf-box-client-secret').value = s.box_client_secret || '';
    document.getElementById('sf-box-enterprise-id').value = s.box_enterprise_id || '';
    document.getElementById('sf-box-root-folder').value = s.box_root_folder || '/Asset Library';
    document.getElementById('sf-sam2-min-pct').value = s.sam2_min_segment_pct || '2';
    document.getElementById('sf-sam2-max-pct').value = s.sam2_max_segment_pct || '60';
    document.getElementById('sf-seg-crop-padding').value = s.seg_crop_padding || '20';
    document.getElementById('sf-seg-detail-level').value = s.seg_detail_level || 'standard';
    document.getElementById('sf-seg-tight-boxes').checked = s.seg_tight_boxes !== 'false';
    document.getElementById('sf-asset-auto-label').checked = s.asset_auto_label !== 'false';
    document.getElementById('sf-asset-auto-label-model').value = s.asset_auto_label_model || 'claude-haiku-4-5';
  } catch (err) { console.error('Settings load error:', err); }
}

async function handleSettingsSave() {
  const data = {
    ai_system_prompt: getVal('s-system-prompt'),
    ai_model: getVal('s-model'),
    ai_instruction_name: getVal('s-instruction-name'),
    ai_instruction_species: getVal('s-instruction-species'),
    ai_instruction_role: getVal('s-instruction-role'),
    ai_instruction_backstory: getVal('s-instruction-backstory'),
    ai_instruction_personality: getVal('s-instruction-personality'),
    ai_instruction_key_passions: getVal('s-instruction-key-passions'),
    ai_instruction_what_they_care_about: getVal('s-instruction-what-they-care-about'),
    ai_instruction_tone_and_voice: getVal('s-instruction-tone-and-voice'),
    ai_instruction_hook_and_audience: getVal('s-instruction-hook-and-audience'),
    ai_quote_instructions: getVal('s-quote-instructions'),
    ai_land_instruction_name: getVal('s-land-instruction-name'),
    ai_land_instruction_description: getVal('s-land-instruction-description'),
    ai_land_instruction_visual_style: getVal('s-land-instruction-visual-style'),
    ai_land_instruction_color_palette: getVal('s-land-instruction-color-palette'),
    ai_land_instruction_themes_and_content: getVal('s-land-instruction-themes-and-content'),
    ai_image_gen_instructions: getVal('s-image-gen-instructions'),
    snowflake_account:   getVal('s-sf-account'),
    snowflake_username:  getVal('s-sf-username'),
    snowflake_warehouse: getVal('s-sf-warehouse'),
    snowflake_database:  getVal('s-sf-database'),
    snowflake_schema:    getVal('s-sf-schema'),
    snowflake_role:      getVal('s-sf-role'),
    snowflake_query:     getVal('s-sf-query'),
    box_client_id: document.getElementById('sf-box-client-id').value,
    box_client_secret: document.getElementById('sf-box-client-secret').value,
    box_enterprise_id: document.getElementById('sf-box-enterprise-id').value,
    box_root_folder: document.getElementById('sf-box-root-folder').value,
    sam2_min_segment_pct: document.getElementById('sf-sam2-min-pct').value,
    sam2_max_segment_pct: document.getElementById('sf-sam2-max-pct').value,
    seg_crop_padding: document.getElementById('sf-seg-crop-padding').value,
    seg_detail_level: document.getElementById('sf-seg-detail-level').value,
    seg_tight_boxes: document.getElementById('sf-seg-tight-boxes').checked ? 'true' : 'false',
    asset_auto_label: document.getElementById('sf-asset-auto-label').checked ? 'true' : 'false',
    asset_auto_label_model: document.getElementById('sf-asset-auto-label-model').value,
  };
  const sfPassword = getVal('s-sf-password');
  if (sfPassword) data.snowflake_password = sfPassword;
  const apiKey = getVal('s-api-key');
  if (apiKey) data.anthropic_api_key = apiKey;
  const openaiKey = getVal('s-openai-api-key');
  if (openaiKey) data.openai_api_key = openaiKey;

  const btn = document.getElementById('settings-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    document.getElementById('s-api-key').value = '';
    document.getElementById('s-openai-api-key').value = '';
    await loadSettings();
    await checkApiKeyStatus();
    btn.textContent = '✓ Saved';
    setTimeout(() => { btn.textContent = 'Save Settings'; btn.disabled = false; }, 1500);
  } catch (err) {
    alert('Save failed: ' + err.message);
    btn.disabled = false; btn.textContent = 'Save Settings';
  }
}

// ── Snowflake Settings helpers ────────────────────────────────
async function saveSnowflakeCredentials() {
  const data = {
    snowflake_account:   getVal('s-sf-account'),
    snowflake_username:  getVal('s-sf-username'),
    snowflake_warehouse: getVal('s-sf-warehouse'),
    snowflake_database:  getVal('s-sf-database'),
    snowflake_schema:    getVal('s-sf-schema'),
    snowflake_role:      getVal('s-sf-role'),
    snowflake_query:     getVal('s-sf-query'),
  };
  const pw = getVal('s-sf-password');
  if (pw) data.snowflake_password = pw;
  await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
}

function updateSfLastSync(lastRefresh, skuCount) {
  const el = document.getElementById('sf-last-sync');
  if (!el) return;
  if (!lastRefresh) { el.textContent = ''; return; }
  const d = new Date(lastRefresh + (lastRefresh.endsWith('Z') ? '' : 'Z'));
  const formatted = d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  el.textContent = `Last synced ${formatted}${skuCount ? ` · ${skuCount} SKUs` : ''}`;
}

// ── Image Samples (Settings) ──────────────────────────────────
async function loadImageSamples() {
  try {
    const res = await fetch('/api/settings/image-samples');
    const { samples } = await res.json();
    renderImageSamples(samples);
  } catch (e) { console.error('Could not load image samples:', e); }
}

function renderImageSamples(samples) {
  const grid = document.getElementById('img-samples-grid');
  if (!grid) return;
  grid.innerHTML = '';
  if (!samples || !samples.length) {
    grid.innerHTML = '<div class="img-samples-empty">No sample images uploaded yet.</div>';
    return;
  }
  samples.forEach(src => {
    const filename = src.split('/').pop();
    const card = document.createElement('div');
    card.className = 'img-sample-card';
    card.innerHTML = `
      <img src="${esc(src)}" class="img-sample-thumb" alt="Sample" />
      <button class="img-sample-delete" data-filename="${esc(filename)}" title="Remove">✕</button>`;
    card.querySelector('.img-sample-delete').addEventListener('click', () => deleteImageSample(filename));
    grid.appendChild(card);
  });
}

async function deleteImageSample(filename) {
  if (!confirm('Remove this sample image?')) return;
  try {
    const res = await fetch(`/api/settings/image-samples/${encodeURIComponent(filename)}`, { method: 'DELETE' });
    const { samples } = await res.json();
    renderImageSamples(samples);
  } catch (e) { alert('Could not delete sample: ' + e.message); }
}

async function uploadImageSamples(files) {
  const status = document.getElementById('img-samples-status');
  status.textContent = `Uploading ${files.length} image${files.length > 1 ? 's' : ''}…`;
  status.classList.remove('hidden');
  let lastSamples = [];
  for (const file of files) {
    const fd = new FormData();
    fd.append('image', file);
    try {
      const res = await fetch('/api/settings/image-samples', { method: 'POST', body: fd });
      const data = await res.json();
      lastSamples = data.samples;
    } catch (e) { console.error('Upload failed:', e); }
  }
  renderImageSamples(lastSamples);
  status.textContent = 'Uploaded!';
  setTimeout(() => status.classList.add('hidden'), 2000);
}

// ── Land Headline Image Generator ─────────────────────────────
let landGenImageUrl = null;   // URL of the most recently generated image (not yet accepted)

async function generateLandImage() {
  const btn    = document.getElementById('land-gen-image-btn');
  const status = document.getElementById('land-gen-status');
  const warn   = document.getElementById('land-gen-openai-warning');
  const preview = document.getElementById('land-gen-preview-wrap');

  // Read current form values (works even if land isn't saved yet)
  const name               = (document.getElementById('fl-name')?.value || '').trim();
  const description        = (document.getElementById('fl-description')?.value || '').trim();
  const visual_style       = (document.getElementById('fl-visual-style')?.value || '').trim();
  const color_palette      = (document.getElementById('fl-color-palette')?.value || '').trim();
  const themes_and_content = (document.getElementById('fl-themes-and-content')?.value || '').trim();

  // Include names of currently selected products as context
  const product_names = landSelectedProducts.map(p => p.name).filter(Boolean);

  btn.disabled = true;
  preview.classList.add('hidden');
  warn.classList.add('hidden');
  status.classList.remove('hidden');
  status.innerHTML = '<span class="land-gen-spinner">⏳</span> Generating your headline image… this takes about 15–30 seconds.';

  try {
    const res = await fetch('/api/ai/generate-land-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, visual_style, color_palette, themes_and_content, product_names }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 400 && data.error && data.error.toLowerCase().includes('openai')) {
        warn.classList.remove('hidden');
      } else {
        status.textContent = '✗ ' + (data.error || 'Generation failed');
      }
      return;
    }

    landGenImageUrl = data.image_url;
    const img = document.getElementById('land-gen-preview-img');
    img.src = data.image_url;
    status.classList.add('hidden');
    preview.classList.remove('hidden');

    // Show prompt peek on click
    const peek = document.getElementById('land-gen-prompt-peek');
    peek.textContent = '📝 Prompt: ' + data.dalle_prompt;

  } catch (err) {
    status.textContent = '✗ ' + err.message;
  } finally {
    btn.disabled = false;
  }
}

async function acceptGeneratedImage() {
  if (!landGenImageUrl) return;
  if (landEditorMode === 'edit' && landEditorId) {
    // Land already exists — patch images array immediately
    try {
      const landData = await fetch(`/api/lands/${landEditorId}`).then(r => r.json());
      const newImages = [landGenImageUrl, ...(landData.images || []).filter(u => u !== landGenImageUrl)];
      const updated = await fetch(`/api/lands/${landEditorId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: newImages }),
      }).then(r => r.json());
      lands = lands.map(l => l.id === updated.id ? updated : l);
      renderLandEditorImages(newImages);
      renderLands();
    } catch (e) { alert('Could not save image: ' + e.message); return; }
  } else {
    // New land — queue the URL; save function will include it after land is created
    if (!pendingLandGenUrls.includes(landGenImageUrl)) {
      pendingLandGenUrls.unshift(landGenImageUrl);
    }
    // Show in gallery (these are already-on-server URLs, not File blobs)
    const existingLand = lands.find(l => l.id === landEditorId);
    renderLandEditorImages(existingLand ? existingLand.images || [] : []);
  }
  document.getElementById('land-gen-preview-wrap').classList.add('hidden');
  landGenImageUrl = null;
}

function discardGeneratedImage() {
  landGenImageUrl = null;
  document.getElementById('land-gen-preview-wrap').classList.add('hidden');
  document.getElementById('land-gen-status').classList.add('hidden');
}

// ── Product Library ───────────────────────────────────────────
let allProducts = [];
let productsLoaded = false;
let selectedProductSkus = new Set();   // picker modal working state
let landSelectedProducts = [];         // land: full product objects for display
let landAiProductImageUrls = [];       // land: image_url strings passed to AI
let charSelectedProductSkus = new Set(); // character: persistent selected SKUs
let charSelectedProducts = [];           // character: full product objects for display
let pickerContext = 'land';              // 'land' | 'character' — set when opening picker
let _pickerSavedLandSkus = new Set();    // backup of land SKUs while character picker is open
let productSearchTimer = null;
const PRODUCT_GRID_LIMIT = 200;

async function loadProducts() {
  if (productsLoaded) return;
  try {
    const res = await fetch('/api/products');
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data)) throw new Error('Products API returned unexpected format');
    allProducts = data;
    productsLoaded = true;
    populateProductFilters();
  } catch (err) {
    console.error('Load products error:', err);
    throw err;
  }
}

function populateProductFilters() {
  const formats   = [...new Set(allProducts.map(p => p.format).filter(Boolean))].sort();
  const occasions = [...new Set(allProducts.map(p => p.occasion).filter(Boolean))].sort();

  const fmtSel = document.getElementById('product-format-filter');
  formats.forEach(f => { const o = document.createElement('option'); o.value = o.textContent = f; fmtSel.appendChild(o); });

  const occSel = document.getElementById('product-occasion-filter');
  occasions.forEach(o => { const el = document.createElement('option'); el.value = el.textContent = o; occSel.appendChild(el); });
}

function getFilteredProducts() {
  const query    = (document.getElementById('product-search').value || '').toLowerCase().trim();
  const format   = document.getElementById('product-format-filter').value;
  const occasion = document.getElementById('product-occasion-filter').value;
  const hideSentiment = document.getElementById('product-hide-sentiment')?.checked;

  return allProducts.filter(p => {
    if (format   && p.format   !== format)   return false;
    if (occasion && p.occasion !== occasion) return false;
    if (hideSentiment && p.product_configuration && p.product_configuration.includes('Sentiment')) return false;
    if (query) {
      const hay = `${p.name} ${p.sku} ${p.occasion} ${p.theme} ${p.format}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });
}

function renderProductGrid() {
  const filtered = getFilteredProducts();
  const shown = filtered.slice(0, PRODUCT_GRID_LIMIT);
  const grid  = document.getElementById('product-picker-grid');

  grid.innerHTML = '';

  if (!shown.length) {
    grid.innerHTML = '<div class="product-picker-empty">No products match your search.</div>';
    document.getElementById('product-picker-status').textContent = '0 products';
    return;
  }

  shown.forEach(product => {
    const tile = document.createElement('div');
    tile.className = 'product-tile' + (selectedProductSkus.has(product.sku) ? ' product-selected' : '');
    tile.dataset.sku = product.sku;

    const rev = product.revenue && product.revenue.t12m > 0
      ? `$${(product.revenue.t12m / 1000).toFixed(0)}K T12M`
      : '';

    tile.innerHTML = `
      <div class="product-tile-image">
        <img src="${esc(product.image_url)}" alt="${esc(product.name)}" />
      </div>
      <div class="product-tile-body">
        <div class="product-tile-name">${esc(product.name)}</div>
        ${product.product_configuration ? `<div class="product-tile-config">${esc(product.product_configuration)}</div>` : ''}
        ${rev ? `<div class="product-tile-rev">${rev}</div>` : ''}
      </div>`;

    tile.addEventListener('click', () => handleProductTileClick(product));
    grid.appendChild(tile);
  });

  const statusEl = document.getElementById('product-picker-status');
  const selCount = selectedProductSkus.size;
  if (filtered.length > PRODUCT_GRID_LIMIT) {
    statusEl.textContent = `Showing ${PRODUCT_GRID_LIMIT} of ${filtered.length.toLocaleString()} — refine to see more${selCount ? ` · ${selCount} selected` : ''}`;
  } else {
    statusEl.textContent = selCount
      ? `${selCount} product${selCount !== 1 ? 's' : ''} selected`
      : `${filtered.length.toLocaleString()} product${filtered.length !== 1 ? 's' : ''}`;
  }
  updateConfirmBtn();
}

function updateConfirmBtn() {
  const n = selectedProductSkus.size;
  const btn = document.getElementById('product-picker-confirm-btn');
  btn.disabled = n === 0;
  btn.textContent = n > 0 ? `Use ${n} Product${n !== 1 ? 's' : ''}` : 'Use This Product';
}

function handleProductTileClick(product) {
  // Toggle selection
  if (selectedProductSkus.has(product.sku)) {
    selectedProductSkus.delete(product.sku);
  } else {
    selectedProductSkus.add(product.sku);
  }
  // Update tile appearance without re-rendering the whole grid
  const tile = document.querySelector(`#product-picker-grid .product-tile[data-sku="${product.sku}"]`);
  if (tile) tile.classList.toggle('product-selected', selectedProductSkus.has(product.sku));

  const n = selectedProductSkus.size;
  const statusEl = document.getElementById('product-picker-status');
  statusEl.textContent = n > 0 ? `${n} product${n !== 1 ? 's' : ''} selected` : '';
  updateConfirmBtn();
}

async function openProductPicker(context = 'land') {
  pickerContext = context;

  if (context === 'character') {
    // Swap in character SKUs; save land SKUs to restore on close/cancel
    _pickerSavedLandSkus = new Set(selectedProductSkus);
    selectedProductSkus = new Set(charSelectedProductSkus);
  }

  document.getElementById('product-picker-status').textContent =
    selectedProductSkus.size ? `${selectedProductSkus.size} product${selectedProductSkus.size !== 1 ? 's' : ''} selected` : '';
  document.getElementById('product-search').value = '';
  document.getElementById('product-format-filter').value = '';
  document.getElementById('product-occasion-filter').value = '';
  updateConfirmBtn();
  document.getElementById('modal-product-picker').classList.remove('hidden');

  if (!productsLoaded) {
    document.getElementById('product-picker-grid').innerHTML =
      '<div class="product-picker-loading">Loading product library…</div>';
    try {
      await loadProducts();
    } catch {
      document.getElementById('product-picker-grid').innerHTML =
        '<div class="product-picker-empty">⚠️ Could not load products. Check your connection and try again.</div>';
      return;
    }
  }
  renderProductGrid();
}

function closeProductPicker() {
  // On cancel, restore land SKUs if we swapped them for character context
  if (pickerContext === 'character') {
    selectedProductSkus = _pickerSavedLandSkus;
  }
  document.getElementById('modal-product-picker').classList.add('hidden');
}

async function confirmProductSelection() {
  if (!selectedProductSkus.size) return;

  if (pickerContext === 'character') {
    // ── Character products ───────────────────────────────────
    charSelectedProductSkus = new Set(selectedProductSkus);
    charSelectedProducts = [...charSelectedProductSkus].map(
      sku => allProducts.find(p => p.sku === sku) || { sku, name: sku, image_url: '' }
    );
    // Restore land SKUs (we swapped them in openProductPicker)
    selectedProductSkus = _pickerSavedLandSkus;
    document.getElementById('modal-product-picker').classList.add('hidden');
    renderCharProductSelection();
    return;
  }

  // ── Land products (original behaviour) ──────────────────────
  const products = [...selectedProductSkus]
    .map(sku => allProducts.find(p => p.sku === sku))
    .filter(p => p && p.image_url);
  if (!products.length) return;

  document.getElementById('modal-product-picker').classList.add('hidden');

  clearAIImage('land');

  landSelectedProducts = products;
  landAiProductImageUrls = products.map(p => p.image_url);
  renderLandProductSelection();
}

function renderLandProductSelection() {
  const n = landSelectedProducts.length;

  // ── Story Builder product reference block (Land Profile tab) ──
  const refBlock     = document.getElementById('land-sb-product-ref');
  const refEmpty     = refBlock?.querySelector('.land-sb-product-ref-empty');
  const refFilled    = refBlock?.querySelector('.land-sb-product-ref-filled');
  const countBadge   = document.getElementById('land-sb-product-count-badge');
  const thumbsEl     = document.getElementById('land-sb-product-thumbs');
  if (refBlock) {
    if (n) {
      refBlock.classList.remove('land-sb-no-products');
      refBlock.classList.add('land-sb-has-products');
      refEmpty.classList.add('hidden');
      refFilled.classList.remove('hidden');
      if (countBadge) countBadge.textContent = n;
      if (thumbsEl) {
        thumbsEl.innerHTML = '';
        landSelectedProducts.slice(0, 8).forEach(p => {
          if (p.image_url) {
            const img = document.createElement('img');
            img.className = 'land-sb-product-thumb';
            img.src = esc(p.image_url);
            img.alt = p.name || p.sku;
            img.title = p.name || p.sku;
            thumbsEl.appendChild(img);
          } else {
            const ph = document.createElement('div');
            ph.className = 'land-sb-product-thumb-placeholder';
            ph.title = p.sku;
            ph.textContent = '📦';
            thumbsEl.appendChild(ph);
          }
        });
        if (n > 8) {
          const more = document.createElement('div');
          more.className = 'land-sb-product-thumb-placeholder';
          more.textContent = `+${n - 8}`;
          thumbsEl.appendChild(more);
        }
      }
    } else {
      refBlock.classList.add('land-sb-no-products');
      refBlock.classList.remove('land-sb-has-products');
      refEmpty.classList.remove('hidden');
      refFilled.classList.add('hidden');
    }
  }

  // ── AI panel compact badge ──────────────────────────────────
  const badge     = document.getElementById('land-product-selection');
  const countSpan = document.getElementById('land-product-selection-count');
  if (badge) {
    if (n) {
      countSpan.textContent = n;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  // ── Form section card display ───────────────────────────────
  const emptyEl   = document.getElementById('land-editor-pf-empty');
  const scrollEl  = document.getElementById('land-editor-pf-scroll');
  const cardsEl   = document.getElementById('land-editor-pf-cards');
  const countEl   = document.getElementById('land-editor-pf-count');

  if (!emptyEl) return; // editor not rendered yet

  if (!n) {
    emptyEl.classList.remove('hidden');
    scrollEl.classList.add('hidden');
    if (countEl) countEl.classList.add('hidden');
    return;
  }

  emptyEl.classList.add('hidden');
  scrollEl.classList.remove('hidden');
  if (countEl) {
    countEl.textContent = `${n} SKU${n !== 1 ? 's' : ''} selected`;
    countEl.classList.remove('hidden');
  }

  cardsEl.innerHTML = '';
  landSelectedProducts.forEach(p => {
    const card = document.createElement('div');
    card.className = 'land-pf-card land-editor-pf-card';
    card.innerHTML = p.image_url
      ? `<div class="land-pf-card-img-wrap"><img src="${esc(p.image_url)}" alt="${esc(p.name || p.sku)}" class="land-pf-card-img" loading="lazy" /></div>
         <div class="land-pf-card-body">${buildProductCardBody(p)}</div>`
      : `<div class="land-pf-card-img-wrap land-pf-card-img-empty"><span class="land-pf-card-img-icon">📦</span></div>
         <div class="land-pf-card-body">${buildProductCardBody(p)}</div>`;
    const removeBtn = document.createElement('button');
    removeBtn.className = 'pf-card-remove';
    removeBtn.title = 'Remove';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', e => {
      e.stopPropagation();
      selectedProductSkus.delete(p.sku);
      landSelectedProducts = landSelectedProducts.filter(x => x.sku !== p.sku);
      renderLandProductSelection();
    });
    card.appendChild(removeBtn);
    cardsEl.appendChild(card);
  });
}

function bindProductPicker() {
  document.getElementById('land-browse-products-btn').addEventListener('click', () => openProductPicker('land'));
  document.getElementById('char-browse-products-btn').addEventListener('click', () => openProductPicker('character'));
  document.getElementById('product-picker-close-btn').addEventListener('click', closeProductPicker);
  document.getElementById('product-picker-cancel-btn').addEventListener('click', closeProductPicker);
  document.getElementById('product-picker-confirm-btn').addEventListener('click', confirmProductSelection);
  document.getElementById('modal-product-picker').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeProductPicker();
  });

  document.getElementById('product-search').addEventListener('input', () => {
    clearTimeout(productSearchTimer);
    productSearchTimer = setTimeout(renderProductGrid, 220);
  });
  document.getElementById('product-format-filter').addEventListener('change', renderProductGrid);
  document.getElementById('product-occasion-filter').addEventListener('change', renderProductGrid);
  document.getElementById('product-hide-sentiment').addEventListener('change', renderProductGrid);
}

// ── Excel Export ──────────────────────────────────────────────
function xlsxDownload(workbook, filename) {
  XLSX.writeFile(workbook, filename);
}

function fmtExportDate(iso) {
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso || ''; }
}

function exportCharactersToExcel() {
  const btn = document.getElementById('catalog-export-btn');
  btn.disabled = true; btn.textContent = '⬇ Exporting…';
  try {
    const rows = characters.map(c => ({
      'Name':                c.name || '',
      'Species':             c.species || '',
      'Role':                c.role || '',
      'Backstory':           c.backstory || '',
      'Personality':         c.personality || '',
      'Key Passions':        c.key_passions || '',
      'What They Care About':c.what_they_care_about || '',
      'Tone & Voice':        c.tone_and_voice || '',
      'My Hook & Audience':  c.hook_and_audience || '',
      'Status':              c.status || '',
      'First Appeared':      c.first_appeared || '',
      'Images':              (c.images || []).join(', '),
      'Character Products':  (c.product_skus || []).join(', '),
      'Created At':          fmtExportDate(c.created_at),
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    // Set column widths
    ws['!cols'] = [
      { wch: 20 }, { wch: 16 }, { wch: 40 }, { wch: 60 }, { wch: 50 },
      { wch: 50 }, { wch: 40 }, { wch: 50 }, { wch: 10 }, { wch: 20 },
      { wch: 40 }, { wch: 14 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Characters');
    xlsxDownload(wb, `lovepop-characters-${datestamp()}.xlsx`);
  } finally {
    btn.disabled = false; btn.innerHTML = '⬇ Export to Excel';
  }
}

function exportLandsToExcel() {
  const btn = document.getElementById('lands-export-btn');
  btn.disabled = true; btn.textContent = '⬇ Exporting…';
  try {
    const rows = lands.map(l => ({
      'Name':              l.name || '',
      'Description':       l.description || '',
      'Visual Style':      l.visual_style || '',
      'Color Palette':     l.color_palette || '',
      'Themes & Content':  l.themes_and_content || '',
      'Status':            l.status || '',
      'Associated SKUs':   (l.product_skus || []).join(', '),
      'Images':            (l.images || []).join(', '),
      'Created At':        fmtExportDate(l.created_at),
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [
      { wch: 26 }, { wch: 60 }, { wch: 50 }, { wch: 40 },
      { wch: 60 }, { wch: 10 }, { wch: 30 }, { wch: 40 }, { wch: 14 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Lands');
    xlsxDownload(wb, `lovepop-lands-${datestamp()}.xlsx`);
  } finally {
    btn.disabled = false; btn.innerHTML = '⬇ Export to Excel';
  }
}

async function exportSettingsToExcel() {
  const btn = document.getElementById('settings-export-btn');
  btn.disabled = true; btn.textContent = '⬇ Exporting…';
  try {
    const res = await fetch('/api/settings');
    const s = await res.json();

    // Sheet 1 — General AI settings
    const generalRows = [
      { 'Setting': 'AI Model',        'Value': s.ai_model || '' },
      { 'Setting': 'AI System Prompt', 'Value': s.ai_system_prompt || '' },
    ];
    const wsGeneral = XLSX.utils.json_to_sheet(generalRows);
    wsGeneral['!cols'] = [{ wch: 22 }, { wch: 100 }];

    // Sheet 2 — Character field instructions
    const charInstructionKeys = [
      ['Name',                 'ai_instruction_name'],
      ['Species',              'ai_instruction_species'],
      ['Role',                 'ai_instruction_role'],
      ['Backstory',            'ai_instruction_backstory'],
      ['Personality',          'ai_instruction_personality'],
      ['Key Passions',         'ai_instruction_key_passions'],
      ['What They Care About', 'ai_instruction_what_they_care_about'],
      ['Tone & Voice',         'ai_instruction_tone_and_voice'],
      ['My Hook & Audience',   'ai_instruction_hook_and_audience'],
    ];
    const charRows = charInstructionKeys.map(([label, key]) => ({
      'Field': label, 'AI Instruction': s[key] || '',
    }));
    const wsChar = XLSX.utils.json_to_sheet(charRows);
    wsChar['!cols'] = [{ wch: 24 }, { wch: 110 }];

    // Sheet 3 — Land field instructions
    const landInstructionKeys = [
      ['Name',              'ai_land_instruction_name'],
      ['Description',       'ai_land_instruction_description'],
      ['Visual Style',      'ai_land_instruction_visual_style'],
      ['Color Palette',     'ai_land_instruction_color_palette'],
      ['Themes & Content',  'ai_land_instruction_themes_and_content'],
    ];
    const landRows = landInstructionKeys.map(([label, key]) => ({
      'Field': label, 'AI Instruction': s[key] || '',
    }));
    const wsLand = XLSX.utils.json_to_sheet(landRows);
    wsLand['!cols'] = [{ wch: 22 }, { wch: 110 }];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, wsGeneral, 'General');
    XLSX.utils.book_append_sheet(wb, wsChar,    'Character Instructions');
    XLSX.utils.book_append_sheet(wb, wsLand,    'Land Instructions');
    xlsxDownload(wb, `lovepop-settings-${datestamp()}.xlsx`);
  } catch (err) {
    alert('Export failed: ' + err.message);
  } finally {
    btn.disabled = false; btn.innerHTML = '⬇ Export to Excel';
  }
}

function datestamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ── Helpers ───────────────────────────────────────────────────
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function cap(str) { return str ? str.charAt(0).toUpperCase() + str.slice(1) : ''; }
function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return iso || '—'; }
}
function setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val || ''; }
function getVal(id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; }

// ═══════════════════════════════════════════════════════════
//  ASSET LIBRARY
// ═══════════════════════════════════════════════════════════

let assetUploadedFiles = [];         // File[] staged for upload
let assetSelectedSkus = [];          // [{sku, name}] selected SKUs
let assetSelectedColors = new Set(); // multi-select
let assetSelectedContentTypes = new Set();
let assetJobs = [];
let assetLibraryItems = [];
let assetQueueFilter = 'all';

// Segment Review Modal state
let srmJobId = null;
let srmSegments = [];
let srmIndex = 0;
let srmReviewedCount = 0;

function bindAssetLibrary() {
  // Sub-tab switching
  document.querySelectorAll('.asset-subtab').forEach(btn => {
    btn.addEventListener('click', () => switchAssetSubtab(btn.dataset.subtab));
  });

  // Drop zone
  const dropZone = document.getElementById('asset-drop-zone');
  const fileInput = document.getElementById('asset-file-input');
  const dropLink = document.getElementById('asset-drop-link');

  dropLink?.addEventListener('click', e => { e.stopPropagation(); fileInput?.click(); });
  dropZone?.addEventListener('click', () => fileInput?.click());
  dropZone?.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone?.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone?.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('drag-over');
    addAssetFiles(Array.from(e.dataTransfer.files));
  });
  fileInput?.addEventListener('change', e => {
    addAssetFiles(Array.from(e.target.files || []));
    e.target.value = '';
  });

  // SKU search typeahead
  const skuSearch = document.getElementById('asset-sku-search');
  const skuDropdown = document.getElementById('asset-sku-dropdown');
  let skuSearchTimer;
  skuSearch?.addEventListener('input', () => {
    clearTimeout(skuSearchTimer);
    skuSearchTimer = setTimeout(() => renderAssetSkuDropdown(skuSearch.value), 180);
  });
  skuSearch?.addEventListener('blur', () => setTimeout(() => skuDropdown?.classList.add('hidden'), 150));

  // Multi-select chips
  document.querySelectorAll('#asset-meta-color-chips .asset-chip').forEach(btn =>
    btn.addEventListener('click', () => toggleAssetChip(btn, assetSelectedColors)));
  document.querySelectorAll('#asset-meta-content-chips .asset-chip').forEach(btn =>
    btn.addEventListener('click', () => toggleAssetChip(btn, assetSelectedContentTypes)));

  // Run segmentation button
  document.getElementById('asset-run-btn')?.addEventListener('click', handleAssetSegmentation);

  // Go to settings link
  document.getElementById('asset-go-to-settings')?.addEventListener('click', e => {
    e.preventDefault(); switchView('settings');
  });

  // View queue button
  document.getElementById('asset-view-queue-btn')?.addEventListener('click', () => switchAssetSubtab('queue'));

  // Queue refresh
  document.getElementById('asset-refresh-queue-btn')?.addEventListener('click', loadAssetJobs);

  // Queue filters
  document.querySelectorAll('.asset-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      assetQueueFilter = btn.dataset.filter;
      document.querySelectorAll('.asset-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderAssetQueue();
    });
  });

  // Browser search/filters
  let browserSearchTimer;
  document.getElementById('asset-browser-search')?.addEventListener('input', () => {
    clearTimeout(browserSearchTimer);
    browserSearchTimer = setTimeout(loadAssetLibraryItems, 280);
  });
  ['asset-browser-occasion', 'asset-browser-art-style', 'asset-browser-element-type'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', loadAssetLibraryItems);
  });

  // Segment review modal
  document.getElementById('srm-close-btn')?.addEventListener('click', closeSRM);
  document.getElementById('srm-save-exit-btn')?.addEventListener('click', closeSRM);
  document.getElementById('srm-send-library-btn')?.addEventListener('click', sendApprovedToLibrary);
  document.getElementById('srm-prev-btn')?.addEventListener('click', () => navigateSRM(-1));
  document.getElementById('srm-next-btn')?.addEventListener('click', () => navigateSRM(1));
  document.getElementById('srm-approve-btn')?.addEventListener('click', () => reviewCurrentSegment('approved'));
  document.getElementById('srm-reject-btn')?.addEventListener('click', () => reviewCurrentSegment('rejected'));
  document.getElementById('srm-merge-btn')?.addEventListener('click', mergeCurrentWithNext);
  document.getElementById('srm-approve-all-btn')?.addEventListener('click', approveAllRemainingSegments);
  document.getElementById('srm-copy-label-btn')?.addEventListener('click', () => {
    const autoLabel = document.getElementById('srm-auto-label')?.textContent;
    if (autoLabel && autoLabel !== '—') {
      document.getElementById('srm-label-input').value = autoLabel;
    }
  });
  document.getElementById('modal-segment-review')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeSRM();
  });

  // Asset detail drawer
  document.getElementById('asset-drawer-close-btn')?.addEventListener('click', closeAssetDrawer);
}

function switchAssetSubtab(tab) {
  document.querySelectorAll('.asset-subtab').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.subtab === tab));
  document.querySelectorAll('.asset-subview').forEach(el => el.classList.add('hidden'));
  document.getElementById(`asset-sub-${tab}`)?.classList.remove('hidden');
  if (tab === 'queue') loadAssetJobs();
  if (tab === 'browser') loadAssetLibraryItems();
}

// ── Upload panel ──────────────────────────────────────────

function addAssetFiles(files) {
  const valid = files.filter(f =>
    /\.(png|jpe?g|webp)$/i.test(f.name) && !assetUploadedFiles.find(x => x.name === f.name)
  );
  assetUploadedFiles = [...assetUploadedFiles, ...valid].slice(0, 20);
  renderAssetFileList();
  updateAssetRunBtn();
}

function renderAssetFileList() {
  const listEl = document.getElementById('asset-file-list');
  if (!listEl) return;
  if (!assetUploadedFiles.length) { listEl.classList.add('hidden'); return; }
  listEl.classList.remove('hidden');
  listEl.innerHTML = '';
  assetUploadedFiles.forEach((file, idx) => {
    const item = document.createElement('div');
    item.className = 'asset-file-item';
    const imgEl = document.createElement('img');
    imgEl.className = 'asset-file-thumb';
    const reader = new FileReader();
    reader.onload = e => { imgEl.src = e.target.result; };
    reader.readAsDataURL(file);
    item.appendChild(imgEl);
    const name = document.createElement('span');
    name.className = 'asset-file-name'; name.textContent = file.name;
    item.appendChild(name);
    const size = document.createElement('span');
    size.className = 'asset-file-size'; size.textContent = formatBytes(file.size);
    item.appendChild(size);
    const rm = document.createElement('button');
    rm.className = 'asset-file-remove'; rm.textContent = '✕';
    rm.addEventListener('click', () => { assetUploadedFiles.splice(idx, 1); renderAssetFileList(); updateAssetRunBtn(); });
    item.appendChild(rm);
    listEl.appendChild(item);
  });
}

function updateAssetRunBtn() {
  const btn = document.getElementById('asset-run-btn');
  if (btn) btn.disabled = assetUploadedFiles.length === 0;
}

function formatBytes(n) {
  if (n >= 1048576) return `${(n/1048576).toFixed(1)} MB`;
  return `${Math.round(n/1024)} KB`;
}

function renderAssetSkuDropdown(query) {
  const dropdown = document.getElementById('asset-sku-dropdown');
  if (!dropdown) return;
  if (!query || query.length < 2) { dropdown.classList.add('hidden'); return; }
  const matches = allProducts
    .filter(p =>
      (p.name || '').toLowerCase().includes(query.toLowerCase()) ||
      (p.sku || '').toLowerCase().includes(query.toLowerCase()))
    .slice(0, 12);
  if (!matches.length) { dropdown.classList.add('hidden'); return; }
  dropdown.innerHTML = '';
  matches.forEach(p => {
    const opt = document.createElement('div');
    opt.className = 'asset-sku-option';
    opt.innerHTML = `<span class="asset-sku-option-name">${esc(p.name || p.sku)}</span><span class="asset-sku-option-sku">${esc(p.sku)}</span>`;
    opt.addEventListener('click', () => {
      if (!assetSelectedSkus.find(x => x.sku === p.sku)) {
        assetSelectedSkus.push({ sku: p.sku, name: p.name || p.sku });
        renderAssetSkuChips();
      }
      dropdown.classList.add('hidden');
      document.getElementById('asset-sku-search').value = '';
    });
    dropdown.appendChild(opt);
  });
  dropdown.classList.remove('hidden');
}

function renderAssetSkuChips() {
  const el = document.getElementById('asset-sku-chips');
  if (!el) return;
  el.innerHTML = '';
  assetSelectedSkus.forEach(({ sku, name }) => {
    const chip = document.createElement('div');
    chip.className = 'asset-sku-chip';
    chip.innerHTML = `${esc(sku)} <button class="asset-sku-chip-remove" title="Remove">×</button>`;
    chip.querySelector('.asset-sku-chip-remove').addEventListener('click', () => {
      assetSelectedSkus = assetSelectedSkus.filter(x => x.sku !== sku);
      renderAssetSkuChips();
    });
    el.appendChild(chip);
  });
}

function toggleAssetChip(btn, set) {
  const val = btn.dataset.value;
  if (set.has(val)) { set.delete(val); btn.classList.remove('selected'); }
  else { set.add(val); btn.classList.add('selected'); }
}

async function handleAssetSegmentation() {
  if (!assetUploadedFiles.length) return;
  const btn = document.getElementById('asset-run-btn');
  const cta = document.getElementById('asset-segment-cta');
  const progress = document.getElementById('asset-progress-panel');
  const progressList = document.getElementById('asset-progress-list');
  const progressCount = document.getElementById('asset-progress-count');

  btn.disabled = true;
  btn.textContent = '⏳ Starting…';

  const metadata = {
    occasion: document.getElementById('asset-meta-occasion')?.value || '',
    theme: document.getElementById('asset-meta-theme')?.value || '',
    sub_theme: document.getElementById('asset-meta-subtheme')?.value || '',
    art_style: document.getElementById('asset-meta-art-style')?.value || '',
    color_family: [...assetSelectedColors],
    content_type: [...assetSelectedContentTypes],
  };

  const formData = new FormData();
  assetUploadedFiles.forEach(f => formData.append('files', f));
  formData.append('metadata', JSON.stringify(metadata));
  formData.append('sku_ids', JSON.stringify(assetSelectedSkus.map(x => x.sku)));
  formData.append('box_folder', document.getElementById('asset-box-folder')?.value || '');
  formData.append('notes', document.getElementById('asset-notes')?.value || '');

  try {
    const res = await fetch('/api/asset-library/segment', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to start segmentation');

    // Show progress panel
    cta.classList.add('hidden');
    progress.classList.remove('hidden');
    if (progressCount) progressCount.textContent = assetUploadedFiles.length;

    if (progressList) {
      progressList.innerHTML = '';
      assetUploadedFiles.forEach(f => {
        const item = document.createElement('div');
        item.className = 'asset-progress-item';
        item.innerHTML = `
          <div class="asset-progress-name">${esc(f.name)}</div>
          <div class="asset-progress-bar-wrap"><div class="asset-progress-bar" style="width:0%"></div></div>
          <div class="asset-progress-status">Queued…</div>`;
        progressList.appendChild(item);
      });
      // Animate bars while polling
      let dots = 0;
      const pollInterval = setInterval(async () => {
        try {
          const pollRes = await fetch(`/api/asset-library/jobs/${data.job_id}`);
          const job = await pollRes.json();
          const items = progressList.querySelectorAll('.asset-progress-item');
          const isComplete = job.status === 'complete' || job.status === 'failed';
          items.forEach((item, i) => {
            const bar = item.querySelector('.asset-progress-bar');
            const status = item.querySelector('.asset-progress-status');
            if (isComplete) {
              bar.style.width = '100%';
              status.textContent = job.status === 'failed' ? '⚠️ Failed' : `${Math.round((job.segment_count||0)/Math.max(items.length,1))} segments found`;
            } else {
              bar.style.width = `${Math.min(80 + dots*5, 95)}%`;
              status.textContent = `Processing… ${'.'.repeat((dots % 3) + 1)}`;
            }
          });
          if (isComplete) {
            clearInterval(pollInterval);
            const segCount = job.segment_count || 0;
            const viewQueueBtn = document.getElementById('asset-view-queue-btn');
            if (job.status === 'failed' || segCount === 0) {
              const errMsg = job.error_message || 'No segments found.';
              if (viewQueueBtn) {
                viewQueueBtn.textContent = `⚠️ View Queue (${segCount} segments)`;
                viewQueueBtn.style.borderColor = 'var(--red)';
                viewQueueBtn.style.color = 'var(--red)';
              }
              // Show error in progress panel
              const progressTitle = document.querySelector('.asset-progress-title');
              if (progressTitle) {
                progressTitle.innerHTML = `<span style="color:var(--red)">⚠️ Segmentation issue</span>`;
              }
              const progressList = document.getElementById('asset-progress-list');
              if (progressList) {
                progressList.innerHTML = `<div style="font-size:12px;color:var(--red);background:#fff0f0;padding:10px 12px;border-radius:6px;line-height:1.5">${esc(errMsg)}</div>`;
              }
            } else {
              if (viewQueueBtn) viewQueueBtn.textContent = `${segCount} segments ready for review →`;
            }
          }
          dots++;
        } catch {}
      }, 1500);

      // Reset upload state
      assetUploadedFiles = [];
      renderAssetFileList();
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = '✨ Run Segmentation';
    alert(`Segmentation failed: ${err.message}`);
  }
}

// ── Review Queue ──────────────────────────────────────────

async function loadAssetJobs() {
  try {
    const res = await fetch('/api/asset-library/jobs');
    if (res.ok) { assetJobs = await res.json(); renderAssetQueue(); }
  } catch {}
}

function renderAssetQueue() {
  const list = document.getElementById('asset-queue-list');
  const empty = document.getElementById('asset-queue-empty');
  if (!list) return;

  const filtered = assetQueueFilter === 'all'
    ? assetJobs
    : assetJobs.filter(j => j.status === assetQueueFilter || j.status?.startsWith(assetQueueFilter));

  if (!filtered.length) { empty?.classList.remove('hidden'); list.innerHTML = ''; return; }
  empty?.classList.add('hidden');
  list.innerHTML = '';
  filtered.forEach(job => {
    const files = job.source_files || [];
    const skus = job.sku_ids || [];
    const row = document.createElement('div');
    row.className = 'asset-queue-row';
    const baseStatus = job.status?.split(':')[0] || 'queued';
    const hasError = job.error_message && (baseStatus === 'failed' || job.segment_count === 0);
    row.innerHTML = `
      <div class="asset-queue-source">
        ${files.map(f => esc(f.filename || f)).join(', ') || 'Unknown files'}
        <div class="asset-queue-source-sub">${new Date(job.created_at).toLocaleString()}</div>
        ${hasError ? `<div style="font-size:11px;color:var(--red);margin-top:4px">⚠️ ${esc(job.error_message)}</div>` : ''}
      </div>
      ${skus.length ? `<div class="asset-queue-skus">${skus.slice(0,3).map(esc).join(', ')}${skus.length > 3 ? ` +${skus.length-3}` : ''}</div>` : ''}
      <div class="asset-queue-seg-count">${job.segment_count || 0} segments</div>
      <span class="asset-queue-status status-${baseStatus}">${baseStatus}</span>
      ${baseStatus === 'complete' && job.segment_count > 0 ? `<button class="btn-secondary" data-job-id="${esc(job.id)}" style="font-size:11px;padding:5px 12px;white-space:nowrap">Review →</button>` : ''}`;
    const reviewBtn = row.querySelector('[data-job-id]');
    reviewBtn?.addEventListener('click', () => openSRM(job.id));
    list.appendChild(row);
  });
  const count = document.getElementById('assets-count');
  if (count) count.textContent = `${assetJobs.length} job${assetJobs.length !== 1 ? 's' : ''}`;
}

// ── Segment Review Modal ──────────────────────────────────

async function openSRM(jobId) {
  srmJobId = jobId;
  srmIndex = 0;
  srmReviewedCount = 0;
  try {
    const res = await fetch(`/api/asset-library/jobs/${jobId}`);
    const job = await res.json();
    srmSegments = (job.segments || []).filter(s => s.status !== 'library');
    document.getElementById('srm-source-name').textContent = (job.source_files || []).map(f => f.filename || f).join(', ');
    document.getElementById('srm-segment-count').textContent = `${srmSegments.length} segments`;
    document.getElementById('modal-segment-review').classList.remove('hidden');
    renderSRMSegment();
  } catch (err) { alert(`Failed to load job: ${err.message}`); }
}

function closeSRM() {
  document.getElementById('modal-segment-review').classList.add('hidden');
  loadAssetJobs();
}

async function sendApprovedToLibrary() {
  if (!srmJobId) return;
  const btn = document.getElementById('srm-send-library-btn');
  const approvedCount = srmSegments.filter(s => s.status === 'approved').length;
  if (!approvedCount) return;

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Sending…';

  try {
    const res = await fetch(`/api/asset-library/jobs/${srmJobId}/upload-approved`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');

    // Close modal, switch to Asset Browser to show results
    closeSRM();
    switchAssetSubtab('browser');
    loadAssetLibraryItems();
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-ai-icon">→</span> Send Approved to Library';
    document.getElementById('srm-send-summary').textContent = `⚠️ ${err.message}`;
  }
}

function renderSRMSegment() {
  if (!srmSegments.length) {
    document.getElementById('srm-nav-label').textContent = 'No segments';
    return;
  }

  const seg = srmSegments[srmIndex];
  const isReviewed = seg.status === 'approved' || seg.status === 'rejected';
  const allDone = srmSegments.every(s => s.status !== 'pending_review');

  document.getElementById('srm-nav-label').textContent = `Segment ${srmIndex + 1} of ${srmSegments.length}`;
  document.getElementById('srm-prev-btn').disabled = srmIndex === 0;
  document.getElementById('srm-next-btn').disabled = srmIndex === srmSegments.length - 1;

  // Load segment image
  const segImg = document.getElementById('srm-segment-img');
  segImg.src = `/api/asset-library/segments/${seg.id}/image`;
  segImg.onerror = () => { segImg.alt = 'Image not available'; };

  // Bounding box info
  const bbox = seg.mask_bbox || {};
  document.getElementById('srm-meta-bbox').innerHTML =
    bbox.pct_of_image != null
      ? `<span class="srm-meta-label">Coverage:</span> ${Math.round(bbox.pct_of_image)}% of image${bbox.w ? ` · ${bbox.w}×${bbox.h}px` : ''}`
      : '';

  // Auto label
  const autoLabel = seg.auto_label || '';
  document.getElementById('srm-auto-label').textContent = autoLabel || '—';
  document.getElementById('srm-copy-label-btn').style.display = autoLabel ? '' : 'none';

  // Form fields
  document.getElementById('srm-label-input').value = seg.element_label || '';
  document.getElementById('srm-notes-input').value = seg.notes || '';
  const typeVal = seg.element_type || '';
  document.querySelectorAll('input[name="srm-type"]').forEach(r => { r.checked = r.value === typeVal; });

  // Stats
  const approved = srmSegments.filter(s => s.status === 'approved').length;
  const rejected = srmSegments.filter(s => s.status === 'rejected').length;
  const pending = srmSegments.filter(s => s.status === 'pending_review').length;
  document.getElementById('srm-stats').textContent = `${approved} ✓  ${rejected} ✗  ${pending} pending`;
  document.getElementById('srm-approve-all-btn').disabled = srmReviewedCount === 0;

  // Show/hide reviewed status badge and lock buttons if already reviewed
  let statusBadge = document.getElementById('srm-reviewed-badge');
  if (!statusBadge) {
    statusBadge = document.createElement('div');
    statusBadge.id = 'srm-reviewed-badge';
    statusBadge.style.cssText = 'font-size:12px;font-weight:700;padding:4px 12px;border-radius:99px;text-align:center;margin-bottom:8px';
    const actionsEl = document.querySelector('.srm-actions');
    actionsEl?.parentNode.insertBefore(statusBadge, actionsEl);
  }

  const approveBtn = document.getElementById('srm-approve-btn');
  const rejectBtn = document.getElementById('srm-reject-btn');
  const mergeBtn = document.getElementById('srm-merge-btn');

  // Show/hide the Send to Library bar
  const sendBar = document.getElementById('srm-send-bar');
  const sendSummary = document.getElementById('srm-send-summary');
  if (allDone && sendBar) {
    const approvedCount = srmSegments.filter(s => s.status === 'approved').length;
    const rejectedCount = srmSegments.filter(s => s.status === 'rejected').length;
    sendSummary.textContent = `Review complete · ${approvedCount} approved, ${rejectedCount} rejected`;
    sendBar.classList.remove('hidden');
    const sendBtn = document.getElementById('srm-send-library-btn');
    if (sendBtn) sendBtn.disabled = approvedCount === 0;
  } else if (sendBar) {
    sendBar.classList.add('hidden');
  }

  if (allDone) {
    // All segments reviewed — show completion state
    statusBadge.style.display = '';
    statusBadge.style.background = '#e6f7ee';
    statusBadge.style.color = 'var(--green)';
    statusBadge.textContent = `✓ All ${srmSegments.length} segments reviewed`;
    approveBtn.disabled = true; approveBtn.style.opacity = '0.4';
    rejectBtn.disabled = true; rejectBtn.style.opacity = '0.4';
    mergeBtn.disabled = true; mergeBtn.style.opacity = '0.4';
  } else if (isReviewed) {
    // This segment already reviewed — show its status, offer to change
    statusBadge.style.display = '';
    if (seg.status === 'approved') {
      statusBadge.style.background = '#e6f7ee';
      statusBadge.style.color = 'var(--green)';
      statusBadge.textContent = '✓ Approved — click Reject to change';
    } else {
      statusBadge.style.background = '#fff0f0';
      statusBadge.style.color = 'var(--red)';
      statusBadge.textContent = '✗ Rejected — click Approve to change';
    }
    approveBtn.disabled = false; approveBtn.style.opacity = '0.6';
    rejectBtn.disabled = false; rejectBtn.style.opacity = '0.6';
    mergeBtn.disabled = false; mergeBtn.style.opacity = '0.6';
  } else {
    // Pending — normal state
    statusBadge.style.display = 'none';
    approveBtn.disabled = false; approveBtn.style.opacity = '';
    rejectBtn.disabled = false; rejectBtn.style.opacity = '';
    mergeBtn.disabled = false; mergeBtn.style.opacity = '';
  }

  // Trigger auto-label if not yet done
  if (!seg.auto_label) fetchAutoLabel(seg.id);
}

async function fetchAutoLabel(segmentId) {
  try {
    const res = await fetch('/api/asset-library/auto-label', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segment_id: segmentId })
    });
    const data = await res.json();
    if (data.label && srmSegments[srmIndex]?.id === segmentId) {
      srmSegments[srmIndex].auto_label = data.label;
      document.getElementById('srm-auto-label').textContent = data.label;
      document.getElementById('srm-copy-label-btn').style.display = '';
    }
  } catch {}
}

async function reviewCurrentSegment(status) {
  if (!srmSegments.length) return;
  const seg = srmSegments[srmIndex];
  const label = document.getElementById('srm-label-input').value.trim();
  const notes = document.getElementById('srm-notes-input').value.trim();
  const typeEl = document.querySelector('input[name="srm-type"]:checked');
  const elementType = typeEl?.value || '';

  // Briefly dim buttons to prevent double-tap
  const approveBtn = document.getElementById('srm-approve-btn');
  const rejectBtn = document.getElementById('srm-reject-btn');
  approveBtn.disabled = true; rejectBtn.disabled = true;

  try {
    await fetch(`/api/asset-library/segments/${seg.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, element_label: label, element_type: elementType, notes })
    });
    srmSegments[srmIndex].status = status;
    srmSegments[srmIndex].element_label = label;
    srmReviewedCount++;

    // Advance to the next PENDING segment, or stay on last if all done
    let next = srmIndex + 1;
    while (next < srmSegments.length && srmSegments[next].status !== 'pending_review') next++;
    if (next < srmSegments.length) {
      srmIndex = next;
    }
    // Always re-render so the "all done" or "already reviewed" state shows correctly
    renderSRMSegment();
  } catch (err) {
    approveBtn.disabled = false; rejectBtn.disabled = false;
    alert(`Failed to save: ${err.message}`);
  }
}

function navigateSRM(delta) {
  srmIndex = Math.max(0, Math.min(srmSegments.length - 1, srmIndex + delta));
  renderSRMSegment();
}

async function mergeCurrentWithNext() {
  if (srmIndex >= srmSegments.length - 1) return;
  const segA = srmSegments[srmIndex];
  const segB = srmSegments[srmIndex + 1];
  try {
    const res = await fetch('/api/asset-library/segments/merge', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segment_id_a: segA.id, segment_id_b: segB.id })
    });
    const data = await res.json();
    srmSegments[srmIndex].element_label = data.label;
    srmSegments[srmIndex + 1].status = 'rejected';
    document.getElementById('srm-label-input').value = data.label;
    renderSRMSegment();
  } catch (err) { alert(`Merge failed: ${err.message}`); }
}

async function approveAllRemainingSegments() {
  const pending = srmSegments.filter(s => s.status === 'pending_review');
  for (const seg of pending) {
    await fetch(`/api/asset-library/segments/${seg.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' })
    });
    seg.status = 'approved';
  }
  renderSRMSegment();
}

// ── Asset Browser ──────────────────────────────────────────

async function loadAssetLibraryItems() {
  try {
    const params = new URLSearchParams({
      search: document.getElementById('asset-browser-search')?.value || '',
      occasion: document.getElementById('asset-browser-occasion')?.value || '',
      art_style: document.getElementById('asset-browser-art-style')?.value || '',
      element_type: document.getElementById('asset-browser-element-type')?.value || '',
    });
    const res = await fetch(`/api/asset-library/assets?${params}`);
    if (res.ok) { assetLibraryItems = await res.json(); renderAssetBrowser(); }
  } catch {}
}

function renderAssetBrowser() {
  const grid = document.getElementById('asset-browser-grid');
  const empty = document.getElementById('asset-browser-empty');
  if (!grid) return;
  if (!assetLibraryItems.length) { empty?.classList.remove('hidden'); grid.innerHTML = ''; return; }
  empty?.classList.add('hidden');
  grid.innerHTML = '';
  assetLibraryItems.forEach(asset => {
    const card = document.createElement('div');
    card.className = 'asset-browser-card';
    card.innerHTML = `
      <div class="asset-browser-card-img">
        ${asset.box_url ? `<img src="${esc(asset.box_url)}" alt="${esc(asset.element_label)}" loading="lazy" />` : '🖼'}
      </div>
      <div class="asset-browser-card-body">
        <div class="asset-browser-card-label">${esc(asset.element_label || '—')}</div>
        <div class="asset-browser-card-meta">${esc(asset.sku_ids?.join(', ') || '')}${asset.occasion ? ` · ${esc(asset.occasion)}` : ''}</div>
      </div>`;
    card.addEventListener('click', () => openAssetDrawer(asset));
    grid.appendChild(card);
  });
}

function openAssetDrawer(asset) {
  document.getElementById('add-preview-img').src = asset.box_url || '';
  document.getElementById('add-label').textContent = asset.element_label || '—';
  document.getElementById('add-type').textContent = asset.element_type || '—';
  document.getElementById('add-skus').textContent = (asset.sku_ids || []).join(', ') || '—';
  document.getElementById('add-occasion').textContent = asset.occasion || '—';
  document.getElementById('add-theme').textContent = [asset.theme, asset.sub_theme].filter(Boolean).join(' / ') || '—';
  document.getElementById('add-art-style').textContent = asset.art_style || '—';
  document.getElementById('add-source').textContent = asset.source_filename || '—';
  document.getElementById('add-approved').textContent = asset.approved_at ? new Date(asset.approved_at).toLocaleDateString() : '—';
  const boxLink = document.getElementById('add-box-link');
  if (asset.box_url) { boxLink.href = asset.box_url; boxLink.style.display = ''; }
  else { boxLink.style.display = 'none'; }
  document.getElementById('asset-detail-drawer').classList.remove('hidden');
}

function closeAssetDrawer() {
  document.getElementById('asset-detail-drawer').classList.add('hidden');
}

// ══ Character Stories ══════════════════════════════════════════

let charStories = [];
let activeStoryId = null;   // null = new, string = editing existing

function bindCharStories() {
  document.getElementById('cstory-new-btn').addEventListener('click', openNewStory);
  document.getElementById('cstory-generate-btn').addEventListener('click', generateStory);
  document.getElementById('cstory-draft-use-btn').addEventListener('click', useDraftStory);
  document.getElementById('cstory-draft-discard-btn').addEventListener('click', () => {
    document.getElementById('cstory-draft-panel').classList.add('hidden');
  });
  document.getElementById('cstory-save-btn').addEventListener('click', saveStory);
  document.getElementById('cstory-cancel-btn').addEventListener('click', closeStoryEditor);
  document.getElementById('cstory-delete-btn').addEventListener('click', deleteStory);
}

async function loadCharStories() {
  if (!editorCharId) return;
  try {
    const res = await fetch(`/api/characters/${editorCharId}/stories`);
    charStories = await res.json();
    renderStoryList();
  } catch (e) { console.error('loadCharStories error:', e); }
}

function renderStoryList() {
  const emptyEl = document.getElementById('cstory-empty');
  const listEl  = document.getElementById('cstory-list');

  if (!charStories.length) {
    emptyEl.classList.remove('hidden');
    listEl.classList.add('hidden');
    return;
  }
  emptyEl.classList.add('hidden');
  listEl.classList.remove('hidden');

  listEl.innerHTML = '';
  charStories.forEach(story => {
    const card = document.createElement('div');
    card.className = 'cstory-card' + (story.id === activeStoryId ? ' active' : '');
    card.dataset.id = story.id;

    const occasionBadge = story.occasion
      ? `<span class="cstory-card-occasion">${esc(story.occasion)}</span>` : '';
    const statusBadge = story.status === 'ready'
      ? `<span class="cstory-card-occasion cstory-card-status-ready">Ready</span>` : '';
    // Show quote as the card "title", context as the snippet
    const quoteText = story.quote || story.title || 'Untitled Quote';
    const snippetText = (story.context || story.story_body || '').replace(/\n/g, ' ').slice(0, 100);

    card.innerHTML = `
      <div class="cstory-card-body">
        <div class="cstory-card-title cstory-card-quote">${esc(quoteText)}</div>
        <div class="cstory-card-meta">${occasionBadge}${statusBadge}</div>
        ${snippetText ? `<div class="cstory-card-snippet">${esc(snippetText)}${snippetText.length >= 100 ? '…' : ''}</div>` : ''}
      </div>`;

    card.addEventListener('click', () => openStoryEditor(story));
    listEl.appendChild(card);
  });
}

function openNewStory() {
  activeStoryId = null;
  document.getElementById('cstory-editor-label').textContent = 'New Quote';
  document.getElementById('cstory-title-input').value = '';
  document.getElementById('cstory-body-input').value = '';
  document.getElementById('cstory-editor-occasion').value = '';
  document.getElementById('cstory-status-select').value = 'draft';
  document.getElementById('cstory-delete-btn').style.display = 'none';
  document.getElementById('cstory-editor').classList.remove('hidden');
  document.getElementById('cstory-title-input').focus();
  renderStoryList();
}

function openStoryEditor(story) {
  activeStoryId = story.id;
  document.getElementById('cstory-editor-label').textContent = 'Editing Quote';
  // quote field mapped to cstory-title-input, context to cstory-body-input
  document.getElementById('cstory-title-input').value = story.quote || story.title || '';
  document.getElementById('cstory-body-input').value = story.context || story.story_body || '';
  document.getElementById('cstory-editor-occasion').value = story.occasion || '';
  document.getElementById('cstory-status-select').value = story.status || 'draft';
  document.getElementById('cstory-delete-btn').style.display = '';
  document.getElementById('cstory-editor').classList.remove('hidden');
  renderStoryList();
}

function closeStoryEditor() {
  activeStoryId = null;
  document.getElementById('cstory-editor').classList.add('hidden');
  renderStoryList();
}

async function saveStory() {
  const quote   = document.getElementById('cstory-title-input').value.trim();
  const context = document.getElementById('cstory-body-input').value.trim();
  const occasion = document.getElementById('cstory-editor-occasion').value;
  const status   = document.getElementById('cstory-status-select').value;

  if (!quote) { document.getElementById('cstory-title-input').focus(); return; }

  const btn = document.getElementById('cstory-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    if (activeStoryId) {
      await fetch(`/api/characters/${editorCharId}/stories/${activeStoryId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quote, context, occasion, status }),
      });
    } else {
      await fetch(`/api/characters/${editorCharId}/stories`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quote, context, occasion, status }),
      });
    }
    await loadCharStories();
    closeStoryEditor();
  } catch (e) { console.error('saveStory error:', e); }
  finally { btn.disabled = false; btn.textContent = 'Save Quote'; }
}

async function deleteStory() {
  if (!activeStoryId) return;
  if (!confirm('Delete this quote? This cannot be undone.')) return;
  await fetch(`/api/characters/${editorCharId}/stories/${activeStoryId}`, { method: 'DELETE' });
  await loadCharStories();
  closeStoryEditor();
}

async function generateStory() {
  if (!editorCharId) return;
  const btn = document.getElementById('cstory-generate-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Generating…';

  const occasion  = document.getElementById('cstory-occasion-select').value;
  const direction = document.getElementById('cstory-direction').value.trim();

  try {
    const res = await fetch(`/api/characters/${editorCharId}/stories/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ occasion, direction }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Generation failed');

    // draft-title shows the quote, draft-body shows the context
    document.getElementById('cstory-draft-title').textContent = data.quote || '';
    document.getElementById('cstory-draft-body').textContent = data.context || '';
    document.getElementById('cstory-draft-panel').classList.remove('hidden');
  } catch (e) {
    alert('Quote generation failed: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<span class="btn-ai-icon">✨</span> Generate Quote';
  }
}

function useDraftStory() {
  const quote   = document.getElementById('cstory-draft-title').textContent;
  const context = document.getElementById('cstory-draft-body').textContent;
  const occasion = document.getElementById('cstory-occasion-select').value;

  activeStoryId = null;
  document.getElementById('cstory-editor-label').textContent = 'New Quote';
  document.getElementById('cstory-title-input').value = quote;
  document.getElementById('cstory-body-input').value = context;
  document.getElementById('cstory-editor-occasion').value = occasion;
  document.getElementById('cstory-status-select').value = 'draft';
  document.getElementById('cstory-delete-btn').style.display = 'none';
  document.getElementById('cstory-editor').classList.remove('hidden');
  document.getElementById('cstory-draft-panel').classList.add('hidden');
}

// ── Bulk Edit (lives in Settings → Data Tools) ───────────────
function bindBulkEdit() {
  const applyBtn  = document.getElementById('bulk-edit-apply-btn');
  const fieldSel  = document.getElementById('bulk-edit-field');
  const valueGrp  = document.getElementById('bulk-edit-value-group');
  const statusGrp = document.getElementById('bulk-edit-status-group');
  const preview   = document.getElementById('bulk-edit-preview');

  function updatePreview() {
    const count = characters.length;
    const fieldLabel = fieldSel.options[fieldSel.selectedIndex].text;
    preview.textContent = count
      ? `This will update "${fieldLabel}" on all ${count} character${count === 1 ? '' : 's'}.`
      : 'No characters in the library yet.';
  }

  function toggleValueInput() {
    const isStatus = fieldSel.value === 'status';
    valueGrp.style.display  = isStatus ? 'none' : '';
    statusGrp.style.display = isStatus ? '' : 'none';
    updatePreview();
  }

  fieldSel.addEventListener('change', toggleValueInput);
  // Update preview whenever the settings section becomes visible
  document.querySelector('[data-section="s-section-bulk-edit"]')?.addEventListener('click', updatePreview);

  applyBtn.addEventListener('click', async () => {
    if (!characters.length) {
      alert('No characters in the library yet.');
      return;
    }
    const field = fieldSel.value;
    const value = field === 'status'
      ? document.getElementById('bulk-edit-status-value').value
      : document.getElementById('bulk-edit-value').value.trim();
    const fieldLabel = fieldSel.options[fieldSel.selectedIndex].text;
    const count = characters.length;

    if (!confirm(`Apply "${value || '(empty)'}" to "${fieldLabel}" on all ${count} character${count === 1 ? '' : 's'}?\n\nThis cannot be undone.`)) return;

    applyBtn.disabled = true;
    applyBtn.textContent = 'Applying…';
    let success = 0, failed = 0;

    for (const char of characters) {
      try {
        const res = await fetch(`${API}/${char.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [field]: value }),
        });
        if (res.ok) success++;
        else failed++;
      } catch { failed++; }
    }

    applyBtn.disabled = false;
    applyBtn.textContent = 'Apply to All Characters';
    document.getElementById('bulk-edit-value').value = '';
    updatePreview();

    if (failed) alert(`Done: ${success} updated, ${failed} failed.`);
    else alert(`Done: ${success} character${success === 1 ? '' : 's'} updated.`);

    await loadCharacters();
  });
}
