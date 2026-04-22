/* Card Designer Module — fully self-contained, no app.js dependencies */
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────
  let designs = [];
  let activeDesign = null;
  let allProducts = null;

  // Ephemeral generation state (reset on design switch)
  let copyOptions = [];
  let sketchUrls  = [];
  let conceptUrls = [];
  let copyVotes   = [{}, {}, {}];
  let sketchVotes = [{}, {}, {}];
  let conceptVotes = [{}, {}, {}];

  // ── Boot ───────────────────────────────────────────────────────
  function init() {
    let conceptSelectorsLoaded = false;
    document.querySelectorAll('.nav-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        if (tab.dataset.view === 'card-designer') {
          loadDesigns();
          if (!conceptSelectorsLoaded) {
            loadConceptSelectors();
            conceptSelectorsLoaded = true;
          }
        }
      });
    });

    bindUI();
  }

  function bindUI() {
    qs('#cd-new-btn')?.addEventListener('click', newDesign);
    qs('#cd-empty-new-btn')?.addEventListener('click', newDesign);
    qs('#cd-save-meta-btn')?.addEventListener('click', saveMeta);

    // Sub-module tab switching
    document.querySelectorAll('.cd-module-tab').forEach(tab => {
      tab.addEventListener('click', () => switchModule(tab.dataset.module));
    });

    // Product search
    const searchInput = qs('#cd-product-search');
    if (searchInput) {
      searchInput.addEventListener('input', handleProductSearch);
      searchInput.addEventListener('focus', handleProductSearch);
    }

    // Close dropdown on outside click
    document.addEventListener('click', e => {
      if (!e.target.closest('.cd-product-search-wrap')) {
        qs('#cd-product-dropdown')?.classList.add('hidden');
      }
    });

    // Generate buttons
    qs('#cd-copy-generate-btn')?.addEventListener('click', generateCopy);
    qs('#cd-sketch-generate-btn')?.addEventListener('click', generateSketch);
    qs('#cd-concept-generate-btn')?.addEventListener('click', generateConcept);

    // Card Designer settings save buttons
    qs('#cd-settings-save-btn')?.addEventListener('click', saveCDSettings);
    qs('#cd-gemini-key-save-btn')?.addEventListener('click', saveGeminiKey);
  }

  // ── Design list ────────────────────────────────────────────────
  async function loadDesigns() {
    try {
      const resp = await fetch('/api/card-designer/designs');
      designs = await resp.json();
    } catch (e) {
      designs = [];
    }
    renderDesignList();
    updateCount();
  }

  function renderDesignList() {
    const list = qs('#cd-design-list');
    if (!list) return;
    if (!designs.length) {
      list.innerHTML = '<div class="cd-design-list-empty">No designs yet</div>';
      return;
    }
    list.innerHTML = designs.map(d => `
      <div class="cd-design-item${activeDesign?.id === d.id ? ' active' : ''}" data-id="${escAttr(d.id)}">
        <div class="cd-design-item-name">${escHtml(d.name || 'Untitled Design')}</div>
        <div class="cd-design-item-meta">${escHtml(d.sku || '—')} &middot; ${escHtml(d.status)}</div>
      </div>
    `).join('');
    list.querySelectorAll('.cd-design-item').forEach(item => {
      item.addEventListener('click', () => selectDesign(item.dataset.id));
    });
  }

  function updateCount() {
    const el = qs('#cd-designs-count');
    if (el) el.textContent = `${designs.length} design${designs.length !== 1 ? 's' : ''}`;
  }

  async function selectDesign(id) {
    const resp = await fetch(`/api/card-designer/designs/${id}`);
    activeDesign = await resp.json();
    renderDesignList();
    showWorkspace();
  }

  // ── New design ─────────────────────────────────────────────────
  async function newDesign() {
    try {
      const resp = await fetch('/api/card-designer/designs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Design', status: 'draft' }),
      });
      const d = await resp.json();
      if (!resp.ok) throw new Error(d.error || `Server error ${resp.status}`);
      designs.unshift(d);
      activeDesign = d;
      renderDesignList();
      updateCount();
      showWorkspace();
    } catch (e) {
      alert(`Failed to create design: ${e.message}`);
    }
  }

  // ── Workspace ──────────────────────────────────────────────────
  function showWorkspace() {
    qs('#cd-empty-state')?.classList.add('hidden');
    const ws = qs('#cd-active-workspace');
    if (ws) ws.classList.remove('hidden');

    // Populate header fields
    const nameInput = qs('#cd-design-name');
    if (nameInput) nameInput.value = activeDesign.name || '';

    const skuBadge = qs('#cd-sku-badge');
    const skuName  = qs('#cd-sku-name');
    if (skuBadge) skuBadge.textContent = activeDesign.sku || '';
    if (skuName)  skuName.textContent  = activeDesign.product_data?.name || activeDesign.sku || '— no product selected —';

    // Reset ephemeral state
    copyOptions  = [];
    sketchUrls   = [];
    conceptUrls  = [];
    copyVotes    = [{}, {}, {}];
    sketchVotes  = [{}, {}, {}];
    conceptVotes = [{}, {}, {}];

    qs('#cd-copy-options') && (qs('#cd-copy-options').innerHTML = '');
    qs('#cd-sketch-options') && (qs('#cd-sketch-options').innerHTML = '');
    qs('#cd-concept-options') && (qs('#cd-concept-options').innerHTML = '');

    renderSelectedOutputs();
    switchModule('copy');
  }

  function renderSelectedOutputs() {
    renderSelectedCopy();
    renderSelectedSketch();
    renderSelectedConcept();
  }

  function renderSelectedCopy() {
    const el = qs('#cd-copy-selected');
    if (!el) return;
    const copy = activeDesign?.selected_copy || {};
    if (copy.cover || copy.inside_left) {
      el.classList.remove('hidden');
      el.innerHTML = `
        <div class="cd-selected-label">✓ Selected Copy</div>
        <div class="cd-copy-fields">${copyFieldsHtml(copy)}</div>
      `;
    } else {
      el.classList.add('hidden');
    }
  }

  function renderSelectedSketch() {
    const el = qs('#cd-sketch-selected');
    if (!el) return;
    const url = activeDesign?.selected_sketch_url;
    if (url) {
      el.classList.remove('hidden');
      el.innerHTML = `<div class="cd-selected-label">✓ Selected Sketch</div><img src="${escAttr(url)}" class="cd-selected-img" alt="Selected sketch" />`;
    } else {
      el.classList.add('hidden');
    }
  }

  function renderSelectedConcept() {
    const el = qs('#cd-concept-selected');
    if (!el) return;
    const url = activeDesign?.selected_concept_url;
    if (url) {
      el.classList.remove('hidden');
      el.innerHTML = `<div class="cd-selected-label">✓ Selected Concept</div><img src="${escAttr(url)}" class="cd-selected-img" alt="Selected concept" />`;
    } else {
      el.classList.add('hidden');
    }
  }

  function copyFieldsHtml(copy) {
    return [
      ['Cover',        copy.cover],
      ['Inside Left',  copy.inside_left],
      ['Inside Right', copy.inside_right],
      ['Sculpture',    copy.sculpture],
      ['Back of Card', copy.back],
    ]
      .filter(([, v]) => v)
      .map(([label, val]) => `
        <div>
          <div class="cd-copy-field-label">${label}</div>
          <div class="cd-copy-field-value">${escHtml(val)}</div>
        </div>
      `)
      .join('');
  }

  // ── Sub-module tabs ────────────────────────────────────────────
  function switchModule(name) {
    document.querySelectorAll('.cd-module-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.module === name)
    );
    document.querySelectorAll('.cd-module').forEach(m => {
      const isTarget = m.id === `cd-module-${name}`;
      m.classList.toggle('hidden', !isTarget);
      m.classList.toggle('active', isTarget);
    });
  }

  // ── Save design name ───────────────────────────────────────────
  async function saveMeta() {
    if (!activeDesign) return;
    const name = (qs('#cd-design-name')?.value || '').trim() || 'Untitled Design';
    const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    activeDesign = await resp.json();
    designs = designs.map(d => d.id === activeDesign.id ? activeDesign : d);
    renderDesignList();
  }

  // ── Product search ─────────────────────────────────────────────
  async function getProducts() {
    if (!allProducts) {
      const resp = await fetch('/api/products');
      allProducts = (await resp.json()).filter(p => p.sku);
    }
    return allProducts;
  }

  async function handleProductSearch() {
    const input    = qs('#cd-product-search');
    const dropdown = qs('#cd-product-dropdown');
    if (!input || !dropdown) return;
    const q = input.value.toLowerCase().trim();
    let products;
    try { products = await getProducts(); } catch { return; }
    const filtered = q
      ? products.filter(p =>
          (p.name || '').toLowerCase().includes(q) ||
          (p.sku  || '').toLowerCase().includes(q)
        ).slice(0, 12)
      : products.slice(0, 12);
    if (!filtered.length) { dropdown.classList.add('hidden'); return; }
    dropdown.innerHTML = filtered.map(p => `
      <div class="cd-product-option" data-sku="${escAttr(p.sku)}">
        <span class="cd-product-option-name">${escHtml(p.name || p.sku)}</span>
        <span class="cd-product-option-sku">${escHtml(p.sku)}</span>
      </div>
    `).join('');
    dropdown.classList.remove('hidden');
    dropdown.querySelectorAll('.cd-product-option').forEach(opt => {
      opt.addEventListener('click', async () => {
        const prod = allProducts.find(p => p.sku === opt.dataset.sku);
        if (prod) await selectProduct(prod);
        dropdown.classList.add('hidden');
        input.value = '';
      });
    });
  }

  async function selectProduct(prod) {
    const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku:          prod.sku || '',
        product_data: prod,
        name:         activeDesign.name === 'New Design' ? (prod.name || activeDesign.name) : activeDesign.name,
      }),
    });
    activeDesign = await resp.json();
    designs = designs.map(d => d.id === activeDesign.id ? activeDesign : d);
    const skuBadge = qs('#cd-sku-badge');
    const skuName  = qs('#cd-sku-name');
    if (skuBadge) skuBadge.textContent = prod.sku || '';
    if (skuName)  skuName.textContent  = prod.name || prod.sku;
    const nameInput = qs('#cd-design-name');
    if (nameInput) nameInput.value = activeDesign.name || '';
    renderDesignList();
  }

  // ── Copy Generator ─────────────────────────────────────────────
  async function generateCopy() {
    if (!activeDesign) return;
    const btn       = qs('#cd-copy-generate-btn');
    const container = qs('#cd-copy-options');
    setGenerating(btn, container, '⏳ Generating 3 options…', 'Generating 3 copy options via Claude…');

    const direction = qs('#cd-copy-direction')?.value || '';
    const feedback  = buildCopyFeedback();

    try {
      const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}/generate-copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction, feedback }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Generation failed');
      copyOptions = data.options;
      copyVotes   = [{}, {}, {}];
      renderCopyOptions();
    } catch (e) {
      showError(container, e.message);
    } finally {
      resetBtn(btn, '✨ Generate 3 Options');
    }
  }

  function buildCopyFeedback() {
    const liked_examples = copyVotes
      .map((v, i) => v.up && copyOptions[i] ? copyOptions[i] : null)
      .filter(Boolean);
    const disliked_notes = copyVotes
      .map(v => (v.down && v.note) ? v.note : null)
      .filter(Boolean);
    return (liked_examples.length || disliked_notes.length)
      ? { liked_examples, disliked_notes }
      : null;
  }

  function renderCopyOptions() {
    const container = qs('#cd-copy-options');
    if (!container) return;
    container.innerHTML = copyOptions.map((opt, i) => `
      <div class="cd-option-card" data-index="${i}">
        <div class="cd-option-header">
          <span class="cd-option-label">Option ${i + 1}</span>
          <div class="cd-vote-btns">
            <button class="cd-vote-btn${copyVotes[i].up   ? ' active-up'   : ''}" data-action="up"   data-index="${i}">👍</button>
            <button class="cd-vote-btn${copyVotes[i].down ? ' active-down' : ''}" data-action="down" data-index="${i}">👎</button>
          </div>
        </div>
        <div class="cd-copy-fields">${copyFieldsHtml(opt)}</div>
        <div class="cd-option-footer">
          <input type="text" class="cd-note-input" data-index="${i}" placeholder="Note for refinement (optional)…" value="${escAttr(copyVotes[i].note || '')}" />
          <button class="cd-select-btn" data-index="${i}">✓ Select This</button>
        </div>
      </div>
    `).join('');

    bindOptionCardEvents(container, copyVotes, () => renderCopyOptions(), (idx) => selectCopyOption(idx));
  }

  async function selectCopyOption(idx) {
    const copy = copyOptions[idx];
    const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selected_copy: copy }),
    });
    activeDesign = await resp.json();
    designs = designs.map(d => d.id === activeDesign.id ? activeDesign : d);
    renderSelectedCopy();
    markSelected('#cd-copy-options', idx);
  }

  // ── Concept Sketch ─────────────────────────────────────────────
  async function generateSketch() {
    if (!activeDesign) return;
    const btn       = qs('#cd-sketch-generate-btn');
    const container = qs('#cd-sketch-options');
    setGenerating(btn, container, '⏳ Generating sketches…', 'Generating 3 concept sketches via Gemini… (this may take up to 30s per image)');

    const direction = qs('#cd-sketch-direction')?.value || '';
    const feedback  = buildImageFeedback(sketchVotes, sketchUrls);

    try {
      const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}/generate-sketch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction, feedback }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Generation failed');
      sketchUrls  = data.urls;
      sketchVotes = [{}, {}, {}];
      renderImageOptions('sketch');
    } catch (e) {
      showError(container, e.message);
    } finally {
      resetBtn(btn, '✨ Generate 3 Sketches');
    }
  }

  // ── Detailed Concept ───────────────────────────────────────────
  async function generateConcept() {
    if (!activeDesign) return;
    const btn       = qs('#cd-concept-generate-btn');
    const container = qs('#cd-concept-options');
    setGenerating(btn, container, '⏳ Generating concepts…', 'Generating 3 detailed concepts via Gemini… (this may take up to 30s per image)');

    const direction   = qs('#cd-concept-direction')?.value   || '';
    const character_id = qs('#cd-concept-character')?.value  || '';
    const art_style_id = qs('#cd-concept-artstyle')?.value   || '';
    const feedback    = buildImageFeedback(conceptVotes, conceptUrls);

    try {
      const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}/generate-concept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction, character_id, art_style_id, feedback }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Generation failed');
      conceptUrls  = data.urls;
      conceptVotes = [{}, {}, {}];
      renderImageOptions('concept');
    } catch (e) {
      showError(container, e.message);
    } finally {
      resetBtn(btn, '✨ Generate 3 Concepts');
    }
  }

  function buildImageFeedback(votes, urls) {
    const liked_urls     = votes.map((v, i) => v.up   && urls[i] ? urls[i]  : null).filter(Boolean);
    const disliked_notes = votes.map(v       => v.down && v.note ? v.note   : null).filter(Boolean);
    return (liked_urls.length || disliked_notes.length) ? { liked_urls, disliked_notes } : null;
  }

  function renderImageOptions(type) {
    const isSketch   = type === 'sketch';
    const urls       = isSketch ? sketchUrls   : conceptUrls;
    const votes      = isSketch ? sketchVotes  : conceptVotes;
    const containerId = isSketch ? '#cd-sketch-options' : '#cd-concept-options';
    const container   = qs(containerId);
    if (!container) return;

    container.innerHTML = urls.map((url, i) => `
      <div class="cd-option-card cd-option-card-image" data-index="${i}">
        <div class="cd-option-header">
          <span class="cd-option-label">Option ${i + 1}</span>
          <div class="cd-vote-btns">
            <button class="cd-vote-btn${votes[i].up   ? ' active-up'   : ''}" data-action="up"   data-index="${i}">👍</button>
            <button class="cd-vote-btn${votes[i].down ? ' active-down' : ''}" data-action="down" data-index="${i}">👎</button>
          </div>
        </div>
        <img src="${escAttr(url)}" class="cd-option-img" alt="Option ${i + 1}" loading="lazy" />
        <div class="cd-option-footer">
          <input type="text" class="cd-note-input" data-index="${i}" placeholder="Note for refinement (optional)…" value="${escAttr(votes[i].note || '')}" />
          <button class="cd-select-btn" data-index="${i}">✓ Select This</button>
        </div>
      </div>
    `).join('');

    const onSelect = isSketch
      ? (idx) => selectSketchOption(idx)
      : (idx) => selectConceptOption(idx);

    bindOptionCardEvents(container, votes, () => renderImageOptions(type), onSelect);
  }

  async function selectSketchOption(idx) {
    const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selected_sketch_url: sketchUrls[idx] }),
    });
    activeDesign = await resp.json();
    designs = designs.map(d => d.id === activeDesign.id ? activeDesign : d);
    renderSelectedSketch();
    markSelected('#cd-sketch-options', idx);
  }

  async function selectConceptOption(idx) {
    const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selected_concept_url: conceptUrls[idx] }),
    });
    activeDesign = await resp.json();
    designs = designs.map(d => d.id === activeDesign.id ? activeDesign : d);
    renderSelectedConcept();
    markSelected('#cd-concept-options', idx);
  }

  // ── Concept selectors ──────────────────────────────────────────
  async function loadConceptSelectors() {
    try {
      const [charResp, styleResp] = await Promise.all([
        fetch('/api/characters'),
        fetch('/api/art-styles'),
      ]);
      const characters = await charResp.json();
      const artStyles  = await styleResp.json();

      const charSel  = qs('#cd-concept-character');
      const styleSel = qs('#cd-concept-artstyle');

      if (charSel && Array.isArray(characters)) {
        characters.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.id;
          opt.textContent = c.name || `Character #${c.id}`;
          charSel.appendChild(opt);
        });
      }
      if (styleSel && Array.isArray(artStyles)) {
        artStyles.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = s.name || `Style #${s.id}`;
          styleSel.appendChild(opt);
        });
      }
    } catch (e) {
      console.warn('[card-designer] loadConceptSelectors error:', e.message);
    }
  }

  // ── Settings ───────────────────────────────────────────────────
  async function loadCDSettings() {
    try {
      const resp = await fetch('/api/settings');
      const s    = await resp.json();
      setVal('#cd-s-gemini-key',       s.gemini_api_key             || '');
      setVal('#cd-s-gemini-model',     s.gemini_model               || 'gemini-3.1-flash-image-preview');
      setVal('#cd-s-copy-cover',       s.cd_copy_instruction_cover        || '');
      setVal('#cd-s-copy-inside-left', s.cd_copy_instruction_inside_left  || '');
      setVal('#cd-s-copy-inside-right',s.cd_copy_instruction_inside_right || '');
      setVal('#cd-s-copy-sculpture',   s.cd_copy_instruction_sculpture    || '');
      setVal('#cd-s-copy-back',        s.cd_copy_instruction_back         || '');
      setVal('#cd-s-sketch-prompt',    s.cd_sketch_system_prompt          || '');
    } catch (e) {
      console.warn('[card-designer] loadCDSettings error:', e.message);
    }
  }

  async function saveCDSettings() {
    const btn    = qs('#cd-settings-save-btn');
    const status = qs('#cd-settings-save-status');
    if (btn) btn.disabled = true;
    if (status) status.textContent = 'Saving…';

    const payload = {
      gemini_model:                    getVal('#cd-s-gemini-model'),
      cd_copy_instruction_cover:       getVal('#cd-s-copy-cover'),
      cd_copy_instruction_inside_left: getVal('#cd-s-copy-inside-left'),
      cd_copy_instruction_inside_right: getVal('#cd-s-copy-inside-right'),
      cd_copy_instruction_sculpture:   getVal('#cd-s-copy-sculpture'),
      cd_copy_instruction_back:        getVal('#cd-s-copy-back'),
      cd_sketch_system_prompt:         getVal('#cd-s-sketch-prompt'),
    };

    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (status) { status.textContent = 'Saved ✓'; setTimeout(() => { if (status) status.textContent = ''; }, 2000); }
    } catch (e) {
      if (status) status.textContent = 'Error: ' + e.message;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function saveGeminiKey() {
    const btn    = qs('#cd-gemini-key-save-btn');
    const status = qs('#cd-gemini-key-save-status');
    const key    = getVal('#cd-s-gemini-key');
    if (!key) { if (status) status.textContent = 'Key is empty'; return; }
    if (btn) btn.disabled = true;
    if (status) status.textContent = 'Saving…';
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gemini_api_key: key }),
      });
      if (status) { status.textContent = 'Saved ✓'; setTimeout(() => { if (status) status.textContent = ''; }, 2000); }
    } catch (e) {
      if (status) status.textContent = 'Error: ' + e.message;
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // Load CD settings when either settings nav item is clicked
  document.addEventListener('click', e => {
    const navItem = e.target.closest('[data-section="s-section-cd-ai"], [data-section="s-section-gemini"]');
    if (navItem) loadCDSettings();
  });

  // ── Shared helpers ─────────────────────────────────────────────
  function bindOptionCardEvents(container, votes, rerender, onSelect) {
    container.querySelectorAll('.cd-vote-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx    = parseInt(btn.dataset.index, 10);
        const action = btn.dataset.action;
        if (action === 'up') {
          votes[idx].up   = !votes[idx].up;
          if (votes[idx].up) votes[idx].down = false;
        } else {
          votes[idx].down = !votes[idx].down;
          if (votes[idx].down) votes[idx].up = false;
        }
        rerender();
      });
    });

    container.querySelectorAll('.cd-note-input').forEach(inp => {
      inp.addEventListener('input', () => {
        votes[parseInt(inp.dataset.index, 10)].note = inp.value;
      });
    });

    container.querySelectorAll('.cd-select-btn').forEach(btn => {
      btn.addEventListener('click', () => onSelect(parseInt(btn.dataset.index, 10)));
    });
  }

  function setGenerating(btn, container, btnText, msg) {
    if (btn) { btn.disabled = true; btn.textContent = btnText; }
    if (container) container.innerHTML = `<div class="cd-generating">${escHtml(msg)}</div>`;
  }

  function resetBtn(btn, text) {
    if (btn) { btn.disabled = false; btn.textContent = text; }
  }

  function showError(container, msg) {
    if (container) container.innerHTML = `<div class="cd-error">Error: ${escHtml(msg)}</div>`;
  }

  function markSelected(containerSelector, idx) {
    document.querySelectorAll(`${containerSelector} .cd-option-card`).forEach((c, i) => {
      c.classList.toggle('selected', i === idx);
    });
  }

  function qs(sel) { return document.querySelector(sel); }
  function escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function escAttr(s) { return String(s).replace(/"/g,'&quot;'); }
  function setVal(sel, val) { const el = qs(sel); if (el) el.value = val; }
  function getVal(sel) { return qs(sel)?.value || ''; }

  // ── Init ───────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
