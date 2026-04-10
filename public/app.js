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
let pendingCharImages = [];   // File[] queued for upload on create
let pendingLandImages = [];   // File[] queued for upload on create

const CHAR_FIELD_META = [
  { key: 'name',                 label: 'Name',                   inputId: 'f-name' },
  { key: 'species',              label: 'Species',                inputId: 'f-species' },
  { key: 'role',                 label: 'Role',                   inputId: 'f-role' },
  { key: 'backstory',            label: 'Backstory',              inputId: 'f-backstory' },
  { key: 'personality',          label: 'Personality',            inputId: 'f-personality' },
  { key: 'key_passions',         label: 'Key Passions',           inputId: 'f-key-passions' },
  { key: 'what_they_care_about', label: 'What They Care About',   inputId: 'f-what-they-care-about' },
  { key: 'tone_and_voice',       label: 'Tone & Voice',           inputId: 'f-tone-and-voice' },
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
  bindNav();
  bindCatalog();
  bindEditor();
  bindAIPanel();
  bindLands();
  bindLandEditor();
  bindLandAIPanel();
  bindProductPicker();
  bindDetailModal();
  bindLandDetailModal();
  bindSettings();
  loadAll();
  checkApiKeyStatus();
});

// ── Load everything ───────────────────────────────────────────
async function loadAll() {
  await Promise.all([loadCharacters(), loadLands()]);
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
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-editor').classList.add('active');
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  currentView = 'editor';
  window.scrollTo(0, 0);
}

function renderEditorImages(existingUrls) {
  const gallery = document.getElementById('editor-images-gallery');
  gallery.innerHTML = '';
  // Render existing saved images
  existingUrls.forEach((url, idx) => {
    const item = document.createElement('div');
    item.className = 'editor-image-item';
    item.innerHTML = `
      <img src="${esc(url)}" alt="Image ${idx + 1}" loading="lazy" />
      ${idx === 0 ? '<span class="img-primary-badge">Primary</span>' : ''}
      <button class="img-remove-btn" title="Remove image" aria-label="Remove">✕</button>`;
    item.querySelector('.img-remove-btn').addEventListener('click', () => handleCharImageRemove(idx));
    gallery.appendChild(item);
  });
  // Render pending (not-yet-uploaded) images
  pendingCharImages.forEach((file, idx) => {
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
      pendingCharImages.splice(idx, 1);
      const char = editorMode === 'edit' ? characters.find(c => c.id === editorCharId) : null;
      renderEditorImages(char ? char.images || [] : []);
    });
    item.appendChild(img);
    item.appendChild(removeBtn);
    gallery.appendChild(item);
  });
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

function bindEditor() {
  document.getElementById('editor-back-btn').addEventListener('click', () => goBack('catalog'));
  document.getElementById('editor-cancel-btn').addEventListener('click', () => goBack('catalog'));
  document.getElementById('editor-save-btn').addEventListener('click', handleEditorSave);
  document.getElementById('editor-image-upload').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    if (editorMode === 'edit' && editorCharId) {
      // Upload immediately in edit mode
      const btn = document.getElementById('editor-save-btn');
      btn.disabled = true;
      const prevText = btn.textContent;
      btn.textContent = 'Uploading…';
      try {
        let updated;
        for (const file of files) {
          const fd = new FormData();
          fd.append('image', file);
          const res = await fetch(`${API}/${editorCharId}/images`, { method: 'POST', body: fd });
          if (!res.ok) throw new Error('Upload failed');
          updated = await res.json();
        }
        characters = characters.map(c => c.id === updated.id ? updated : c);
        renderEditorImages(updated.images || []);
        renderCatalog();
      } catch (err) { alert('Upload failed: ' + err.message); }
      finally { btn.disabled = false; btn.textContent = prevText; }
    } else {
      // Queue for upload after character is created
      pendingCharImages.push(...files);
      renderEditorImages([]);
    }
    e.target.value = '';
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

  // Optional featured image (small, in the header row)
  const featuredThumb = (land.images && land.images.length)
    ? `<img src="${esc(land.images[0])}" class="land-tile-featured-img" alt="${esc(land.name)}" loading="lazy" />`
    : '';

  // Description snippet
  const descHtml = land.description
    ? `<div class="land-tile-desc">${esc(land.description.substring(0, 110))}${land.description.length > 110 ? '…' : ''}</div>`
    : '';

  // Product family thumbnails (up to 5)
  const skus = land.product_skus || [];
  let pfHtml = '';
  if (skus.length) {
    const thumbs = skus.slice(0, 5).map(sku => {
      const p = productsLoaded ? allProducts.find(pr => pr.sku === sku) : null;
      return p && p.image_url
        ? `<img src="${esc(p.image_url)}" class="land-tile-pf-thumb" title="${esc(p.name || sku)}" loading="lazy" />`
        : `<div class="land-tile-pf-placeholder" title="${esc(sku)}"></div>`;
    }).join('');
    const more = skus.length > 5 ? `<div class="land-tile-pf-more">+${skus.length - 5}</div>` : '';
    pfHtml = `
      <div class="land-tile-pf">
        <div class="land-tile-pf-label">Product Family · ${skus.length} SKU${skus.length !== 1 ? 's' : ''}</div>
        <div class="land-tile-pf-thumbs">${thumbs}${more}</div>
      </div>`;
  }

  tile.innerHTML = `
    <div class="land-tile-header">
      <span class="status-badge status-${land.status}">${cap(land.status)}</span>
      ${featuredThumb}
    </div>
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
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-land-editor').classList.add('active');
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  currentView = 'land-editor';
  window.scrollTo(0, 0);
}

function renderLandEditorImages(existingUrls) {
  const gallery = document.getElementById('land-editor-images-gallery');
  gallery.innerHTML = '';
  existingUrls.forEach((url, idx) => {
    const item = document.createElement('div');
    item.className = 'editor-image-item';
    item.innerHTML = `
      <img src="${esc(url)}" alt="Image ${idx + 1}" loading="lazy" />
      ${idx === 0 ? '<span class="img-primary-badge">Primary</span>' : ''}
      <button class="img-remove-btn" title="Remove image" aria-label="Remove">✕</button>`;
    item.querySelector('.img-remove-btn').addEventListener('click', () => handleLandImageRemove(idx));
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
  document.getElementById('land-product-selection-clear').addEventListener('click', () => {
    clearLandProductSelection();
    document.getElementById('land-ai-description').value = '';
  });
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
    if (p.image_url) {
      card.innerHTML = `
        <div class="land-pf-card-img-wrap">
          <img src="${esc(p.image_url)}" alt="${esc(p.name || p.sku)}" class="land-pf-card-img" />
        </div>
        <div class="land-pf-card-body">
          <div class="land-pf-card-name">${esc(p.name || p.sku)}</div>
          <div class="land-pf-card-sku">${esc(p.sku)}</div>
        </div>`;
    } else {
      card.innerHTML = `
        <div class="land-pf-card-img-wrap land-pf-card-img-empty"><span class="land-pf-card-img-icon">📦</span></div>
        <div class="land-pf-card-body">
          <div class="land-pf-card-name">${esc(p.sku)}</div>
          <div class="land-pf-card-sku">Loading…</div>
        </div>`;
    }
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
    const product = productsLoaded ? allProducts.find(p => p.sku === sku) : null;
    const card = document.createElement('div');
    card.className = 'land-pf-card';
    if (product && product.image_url) {
      card.innerHTML = `
        <div class="land-pf-card-img-wrap">
          <img src="${esc(product.image_url)}" alt="${esc(product.name)}" class="land-pf-card-img" />
        </div>
        <div class="land-pf-card-body">
          <div class="land-pf-card-name">${esc(product.name)}</div>
          <div class="land-pf-card-sku">${esc(sku)}</div>
        </div>`;
    } else {
      card.innerHTML = `
        <div class="land-pf-card-img-wrap land-pf-card-img-empty"><span class="land-pf-card-img-icon">📦</span></div>
        <div class="land-pf-card-body">
          <div class="land-pf-card-name">${esc(sku)}</div>
          <div class="land-pf-card-sku">Loading…</div>
        </div>`;
    }
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
  document.getElementById('detail-image-upload').addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length || !activeDetailId) return;
    try {
      let updated;
      for (const file of files) {
        const fd = new FormData();
        fd.append('image', file);
        const res = await fetch(`${API}/${activeDetailId}/images`, { method: 'POST', body: fd });
        if (!res.ok) throw new Error('Upload failed');
        updated = await res.json();
      }
      characters = characters.map(c => c.id === updated.id ? updated : c);
      renderDetailImages(updated);
      renderCatalog();
    } catch (err) { alert('Upload failed: ' + err.message); }
    e.target.value = '';
  });
}

function openDetailModal(id) {
  const char = characters.find(c => c.id === id);
  if (!char) return;
  activeDetailId = id;

  document.getElementById('detail-name').textContent = char.name;
  document.getElementById('detail-meta').textContent = [char.species, char.role].filter(Boolean).join(' · ');
  ['backstory','personality','key_passions','what_they_care_about','tone_and_voice','first_appeared'].forEach(f => {
    document.getElementById(`detail-${f.replace(/_/g,'-')}`).textContent = char[f] || '—';
  });
  document.getElementById('detail-status').innerHTML = `<span class="status-badge status-${char.status}">${cap(char.status)}</span>`;

  renderDetailImages(char);
  renderCharDetailProducts(char);
  document.getElementById('modal-detail').classList.remove('hidden');

  const skus = char.product_skus || [];
  if (skus.length && !productsLoaded) {
    loadProducts().then(() => {
      if (activeDetailId === id) renderCharDetailProducts(char);
    }).catch(() => {});
  }
}

function renderDetailImages(char) {
  const imgEl = document.getElementById('detail-images');
  if (char.images && char.images.length) {
    imgEl.innerHTML = '';
    char.images.forEach((src, idx) => {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'position:relative;';
      wrapper.innerHTML = `<img src="${esc(src)}" alt="${esc(char.name)}" style="cursor:default" />
        <button style="position:absolute;top:3px;right:3px;width:20px;height:20px;border-radius:50%;border:none;background:rgba(214,59,47,.8);color:#fff;cursor:pointer;font-size:11px;display:flex;align-items:center;justify-content:center;padding:0" title="Remove image">✕</button>`;
      wrapper.querySelector('button').addEventListener('click', async () => {
        try {
          const res = await fetch(`${API}/${char.id}/images/${idx}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('Remove failed');
          const updated = await res.json();
          characters = characters.map(c => c.id === updated.id ? updated : c);
          renderDetailImages(updated);
          renderCatalog();
        } catch (err) { alert('Could not remove: ' + err.message); }
      });
      imgEl.appendChild(wrapper);
    });
  } else {
    imgEl.innerHTML = `<div class="image-placeholder"><div class="image-placeholder-icon">🖼</div><div class="image-placeholder-text">No images yet</div></div>`;
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
    const product = productsLoaded ? allProducts.find(p => p.sku === sku) : null;
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
    setVal('s-land-instruction-name', s.ai_land_instruction_name);
    setVal('s-land-instruction-description', s.ai_land_instruction_description);
    setVal('s-land-instruction-visual-style', s.ai_land_instruction_visual_style);
    setVal('s-land-instruction-color-palette', s.ai_land_instruction_color_palette);
    setVal('s-land-instruction-themes-and-content', s.ai_land_instruction_themes_and_content);

    const badge = document.getElementById('api-key-status-badge');
    badge.className = s.api_key_configured ? 'api-key-badge configured' : 'api-key-badge missing';
    badge.textContent = s.api_key_configured ? '✓ API Key Configured' : '✗ API Key Not Set';
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
    ai_land_instruction_name: getVal('s-land-instruction-name'),
    ai_land_instruction_description: getVal('s-land-instruction-description'),
    ai_land_instruction_visual_style: getVal('s-land-instruction-visual-style'),
    ai_land_instruction_color_palette: getVal('s-land-instruction-color-palette'),
    ai_land_instruction_themes_and_content: getVal('s-land-instruction-themes-and-content'),
  };
  const apiKey = getVal('s-api-key');
  if (apiKey) data.anthropic_api_key = apiKey;

  const btn = document.getElementById('settings-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    document.getElementById('s-api-key').value = '';
    await loadSettings();
    await checkApiKeyStatus();
    btn.textContent = '✓ Saved';
    setTimeout(() => { btn.textContent = 'Save Settings'; btn.disabled = false; }, 1500);
  } catch (err) {
    alert('Save failed: ' + err.message);
    btn.disabled = false; btn.textContent = 'Save Settings';
  }
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
    allProducts = await res.json();
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

  // Pre-fill description with product context if field is empty
  const descEl = document.getElementById('land-ai-description');
  if (!descEl.value.trim()) {
    const names = products.map(p => p.name).join('; ');
    const occasions = [...new Set(products.map(p => p.occasion).filter(Boolean))].join(', ');
    const themes    = [...new Set(products.map(p => p.theme).filter(Boolean))].join(', ');
    const parts = [`Products: ${names}`];
    if (occasions) parts.push(`Occasions: ${occasions}`);
    if (themes)    parts.push(`Themes: ${themes}`);
    descEl.value = parts.join('\n');
  }
}

function renderLandProductSelection() {
  const n = landSelectedProducts.length;

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
    if (p.image_url) {
      card.innerHTML = `
        <div class="land-pf-card-img-wrap">
          <img src="${esc(p.image_url)}" alt="${esc(p.name || p.sku)}" class="land-pf-card-img" loading="lazy" />
        </div>
        <div class="land-pf-card-body">
          <div class="land-pf-card-name">${esc(p.name || p.sku)}</div>
          <div class="land-pf-card-sku">${esc(p.sku)}</div>
        </div>`;
    } else {
      card.innerHTML = `
        <div class="land-pf-card-img-wrap land-pf-card-img-empty">
          <span class="land-pf-card-img-icon">📦</span>
        </div>
        <div class="land-pf-card-body">
          <div class="land-pf-card-name">${esc(p.sku)}</div>
          <div class="land-pf-card-sku">Loading…</div>
        </div>`;
    }
    cardsEl.appendChild(card);
  });
}

function bindProductPicker() {
  document.getElementById('land-browse-products-btn').addEventListener('click', () => openProductPicker('land'));
  document.getElementById('land-browse-products-btn2').addEventListener('click', () => openProductPicker('land'));
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
