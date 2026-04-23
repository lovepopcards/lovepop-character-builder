/* Card Designer Module — fully self-contained, no app.js dependencies */
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────
  let designs = [];
  let activeDesign = null;
  let allProducts = null;
  let selectedStyleId = null;   // art style visual grid

  // Dashboard filters
  let cdFilter = 'all';
  let cdSort   = 'newest';
  let cdSearch = '';

  // ── localStorage helpers (all keys scoped by card-design ID) ──
  function lsGet(cardId, key, fallback = null) {
    try { const v = localStorage.getItem(`cd:${cardId}:${key}`); return v !== null ? v : fallback; }
    catch { return fallback; }
  }
  function lsSet(cardId, key, val) {
    try { localStorage.setItem(`cd:${cardId}:${key}`, String(val)); } catch {}
  }

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
          showDashboard();
          loadDesigns();
          if (!conceptSelectorsLoaded) {
            loadConceptSelectors();
            conceptSelectorsLoaded = true;
          }
        }
      });
    });

    bindUI();
    bindDashboardUI();
    initRouting();
  }

  function bindUI() {
    // Sub-module tab switching (.cd-step-row and .cd-track-tab both have .cd-module-tab)
    document.querySelectorAll('.cd-module-tab').forEach(tab => {
      tab.addEventListener('click', () => switchModule(tab.dataset.module));
    });

    // Product title auto-save on blur
    qs('#cd-product-title')?.addEventListener('blur', saveMeta);

    // Art style picker modal
    qs('#cd-style-picker-btn')?.addEventListener('click', openStyleModal);
    qs('#cd-style-modal-close')?.addEventListener('click', closeStyleModal);
    qs('#cd-style-modal-cancel')?.addEventListener('click', closeStyleModal);
    qs('#cd-style-modal-confirm')?.addEventListener('click', confirmStyleSelection);
    qs('#cd-style-modal-none')?.addEventListener('click', () => selectStyleInModal(null, null));
    // Close on backdrop click
    qs('#cd-style-modal')?.addEventListener('click', e => {
      if (e.target === qs('#cd-style-modal')) closeStyleModal();
    });

    // Creative direction auto-save on blur
    qs('#cd-creative-direction')?.addEventListener('blur', saveMeta);

    // Design name auto-save on blur
    qs('#cd-design-name')?.addEventListener('blur', saveMeta);

    // Generate count buttons
    document.querySelectorAll('.cd-gen-n').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.cd-gen-n').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Regenerate / generate copy button
    qs('#cd-regen-btn')?.addEventListener('click', generateCopyRound);

    // Sketch generate
    qs('#cd-sketch-generate-btn')?.addEventListener('click', generateSketchRound);

    // Fidelity stops
    document.querySelectorAll('.cd-fidelity-stop').forEach(stop => {
      stop.addEventListener('click', () => setFidelity(stop.dataset.fidelity));
    });

    // Refine input ⌘+Enter / Ctrl+Enter
    qs('#cd-refine-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generateSketchRound();
    });

    // Select as final — sketch (in refine bar)
    qs('#cd-sketch-final-btn')?.addEventListener('click', promoteSketch);

    // Right panel refine
    qs('#cd-right-refine-btn')?.addEventListener('click', refineRightCard);

    // Card Designer settings save buttons
    qs('#cd-settings-save-btn')?.addEventListener('click', saveCDSettings);
    qs('#cd-gemini-key-save-btn')?.addEventListener('click', saveGeminiKey);
  }

  function bindDashboardUI() {
    // New design buttons
    qs('#cd-new-btn')?.addEventListener('click', newDesign);
    qs('#cd-new-btn-ws')?.addEventListener('click', newDesign);
    qs('#cd-empty-new-btn')?.addEventListener('click', newDesign);

    // Back to dashboard
    qs('#cd-back-btn')?.addEventListener('click', showDashboard);

    // Filter pills
    document.querySelectorAll('.cd-filter-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        document.querySelectorAll('.cd-filter-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        cdFilter = pill.dataset.filter;
        renderDashboard();
      });
    });

    // Sort
    qs('#cd-dash-sort')?.addEventListener('change', e => {
      cdSort = e.target.value;
      renderDashboard();
    });

    // Search
    qs('#cd-dash-search')?.addEventListener('input', e => {
      cdSearch = e.target.value;
      renderDashboard();
    });
  }

  // ── Navigation ─────────────────────────────────────────────────
  function showDashboard() {
    qs('#cd-dashboard')?.classList.remove('hidden');
    qs('#cd-workspace-view')?.classList.add('hidden');
    renderDashboard();
    if (window.location.pathname.startsWith('/card-designer/')) {
      history.pushState(null, '', '/card-designer');
    }
  }

  function showWorkspaceView() {
    qs('#cd-dashboard')?.classList.add('hidden');
    qs('#cd-workspace-view')?.classList.remove('hidden');
    const targetPath = `/card-designer/${activeDesign?.id}`;
    if (window.location.pathname !== targetPath) {
      history.pushState({ cardId: activeDesign?.id }, '', targetPath);
    }
  }

  // ── Design list ────────────────────────────────────────────────
  async function loadDesigns() {
    try {
      const resp = await fetch('/api/card-designer/designs');
      designs = await resp.json();
    } catch (e) {
      designs = [];
    }
    renderDashboard();
    renderDesignList();
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

  // ── Dashboard ──────────────────────────────────────────────────
  function renderDashboard() {
    // Update filter counts
    const counts = {
      all:               designs.length,
      'in-development':  designs.filter(d => d.status === 'in-development').length,
      'ready-for-review': designs.filter(d => d.status === 'ready-for-review').length,
      complete:          designs.filter(d => d.status === 'complete').length,
    };
    qs('#cd-count-all') && (qs('#cd-count-all').textContent = counts.all);
    qs('#cd-count-in-development') && (qs('#cd-count-in-development').textContent = counts['in-development']);
    qs('#cd-count-ready-for-review') && (qs('#cd-count-ready-for-review').textContent = counts['ready-for-review']);
    qs('#cd-count-complete') && (qs('#cd-count-complete').textContent = counts.complete);

    // Filter + search + sort
    let filtered = designs.filter(d => cdFilter === 'all' || d.status === cdFilter);
    if (cdSearch) {
      const lq = cdSearch.toLowerCase();
      filtered = filtered.filter(d =>
        (d.name || '').toLowerCase().includes(lq) ||
        (d.sku  || '').toLowerCase().includes(lq)
      );
    }
    if (cdSort === 'oldest') filtered = [...filtered].reverse();
    else if (cdSort === 'name') filtered = [...filtered].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    else if (cdSort === 'progress') filtered = [...filtered].sort((a, b) => progressScore(b) - progressScore(a));

    const grid = qs('#cd-dash-grid');
    if (!grid) return;

    if (!filtered.length) {
      grid.innerHTML = `
        <div class="cd-dash-empty">
          <div class="cd-dash-empty-icon">🎴</div>
          <div class="cd-dash-empty-title">${designs.length ? 'No matching designs' : 'No designs yet'}</div>
          <div class="cd-dash-empty-sub">${designs.length ? 'Try a different filter or search.' : 'Create your first card design to get started.'}</div>
          ${!designs.length ? '<button class="btn-primary" id="cd-empty-new-btn">+ New Design</button>' : ''}
        </div>
      `;
      qs('#cd-empty-new-btn')?.addEventListener('click', newDesign);
      return;
    }

    grid.innerHTML = filtered.map(d => cardTileHtml(d)).join('');
    grid.querySelectorAll('.cd-card-tile').forEach(tile => {
      tile.addEventListener('click', () => selectDesign(tile.dataset.id));
    });
  }

  function progressScore(d) {
    return (d.progress || []).reduce((acc, s) => acc + (s === 'done' ? 2 : s === 'active' ? 1 : 0), 0);
  }

  function cardTileHtml(d) {
    const progress = d.progress || ['empty', 'empty', 'empty'];
    const isDone   = d.status === 'complete';
    const isReview = d.status === 'ready-for-review';

    const statusLabel = {
      'in-development':  'In development',
      'ready-for-review': 'Ready for review',
      complete:          'Complete',
    }[d.status] || d.status;

    const statusClass = {
      'in-development':  'cd-status-dev',
      'ready-for-review': 'cd-status-review',
      complete:          'cd-status-complete',
    }[d.status] || '';

    const copyDone    = progress[0] === 'done';
    const sketchDone  = progress[1] === 'done';
    const conceptDone = progress[2] === 'done';

    const nodeLabels = ['Copy', 'Sketch', 'Concept'];
    const progressNodes = progress.map((s, i) => `
      <div class="cd-prog-node cd-prog-${s}" title="${nodeLabels[i]}">${s === 'done' ? '✓' : ''}</div>
    `).join('');
    const progressLabelHtml = nodeLabels.map((l, i) => `<span class="cd-prog-label cd-prog-label-${progress[i]}">${l}</span>`).join('');

    const charPill = d.character_name ? `<span class="cd-ctx-pill"><span class="cd-ctx-dot cd-ctx-dot-coral"></span>${escHtml(d.character_name)}</span>` : '';
    const stylePill = d.art_style_name ? `<span class="cd-ctx-pill"><span class="cd-ctx-dot cd-ctx-dot-grad"></span>${escHtml(d.art_style_name)}</span>` : '';

    const rc = d.rounds_count || 0;
    const roundsText = rc > 0 ? `${rc} round${rc !== 1 ? 's' : ''}` : 'No rounds yet';

    return `
      <div class="cd-card-tile" data-id="${escAttr(d.id)}">
        <div class="cd-tile-preview">
          ${tilePreviewSvg(d.id, copyDone, sketchDone, conceptDone, isDone)}
          <span class="cd-tile-status ${statusClass}">${escHtml(statusLabel)}</span>
          ${isReview ? '<div class="cd-tile-ribbon">READY FOR REVIEW</div>' : ''}
        </div>
        <div class="cd-tile-body">
          ${d.sku ? `<div class="cd-tile-sku">${escHtml(d.sku)}</div>` : ''}
          <div class="cd-tile-name">${escHtml(d.name || 'Untitled Design')}</div>
          <div class="cd-tile-progress">
            ${progressNodes}
            <span class="cd-prog-labels">${progressLabelHtml}</span>
          </div>
          ${(charPill || stylePill) ? `<div class="cd-tile-ctx">${charPill}${stylePill}</div>` : ''}
          <div class="cd-tile-meta">
            <span class="cd-tile-rounds">${roundsText}</span>
            <span class="cd-tile-time">${formatTimeAgo(d.updated_at || d.created_at)}</span>
          </div>
        </div>
      </div>
    `;
  }

  function tilePreviewSvg(id, copyDone, sketchDone, conceptDone, isDone) {
    const uid = `pg${id}`.replace(/[^a-z0-9]/gi, '');
    if (isDone || conceptDone) {
      return `<svg width="100%" height="140" viewBox="0 0 280 140" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="${uid}" x1="0" y1="0" x2="280" y2="140" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#1B2A4A"/><stop offset="100%" stop-color="#3D5A99"/>
        </linearGradient></defs>
        <rect width="280" height="140" fill="url(#${uid})" rx="4"/>
        ${isDone
          ? '<circle cx="140" cy="70" r="28" fill="#2D9E5F" opacity="0.9"/><text x="140" y="78" text-anchor="middle" font-size="22" fill="white">✓</text>'
          : '<circle cx="140" cy="70" r="28" fill="white" opacity="0.08"/><text x="140" y="78" text-anchor="middle" font-size="22" fill="white" opacity="0.4">✦</text>'}
      </svg>`;
    } else if (sketchDone) {
      return `<svg width="100%" height="140" viewBox="0 0 280 140" xmlns="http://www.w3.org/2000/svg">
        <rect width="280" height="140" fill="#F7F4EF" rx="4"/>
        <g stroke="#1B2A4A" stroke-width="1" opacity="0.55">
          <line x1="80" y1="110" x2="200" y2="110"/>
          <line x1="90" y1="110" x2="140" y2="48" stroke-width="1.5"/>
          <line x1="190" y1="110" x2="140" y2="48" stroke-width="1.5"/>
          <line x1="100" y1="92" x2="180" y2="92"/>
          <line x1="110" y1="76" x2="170" y2="76"/>
          <line x1="106" y1="92" x2="140" y2="60"/>
          <line x1="174" y1="92" x2="140" y2="60"/>
        </g>
        <text x="140" y="130" text-anchor="middle" font-size="9" fill="#1B2A4A" opacity="0.35" font-family="monospace">CONCEPT SKETCH</text>
      </svg>`;
    } else if (copyDone) {
      return `<svg width="100%" height="140" viewBox="0 0 280 140" xmlns="http://www.w3.org/2000/svg">
        <rect width="280" height="140" fill="#FBF9F6" rx="4"/>
        <rect x="70" y="18" width="140" height="104" rx="5" fill="white" stroke="#E5DFD5" stroke-width="1.5"/>
        <line x1="90" y1="44" x2="190" y2="44" stroke="#C9BFB0" stroke-width="1.5"/>
        <line x1="90" y1="58" x2="190" y2="58" stroke="#C9BFB0" stroke-width="1.5"/>
        <line x1="90" y1="72" x2="165" y2="72" stroke="#C9BFB0" stroke-width="1.5"/>
        <line x1="90" y1="90" x2="178" y2="90" stroke="#E5DFD5" stroke-width="1"/>
        <line x1="90" y1="103" x2="152" y2="103" stroke="#E5DFD5" stroke-width="1"/>
      </svg>`;
    } else {
      return `<svg width="100%" height="140" viewBox="0 0 280 140" xmlns="http://www.w3.org/2000/svg">
        <rect width="280" height="140" fill="#F2EDE6" rx="4"/>
        <rect x="95" y="30" width="90" height="80" rx="5" fill="white" stroke="#DDD6CA" stroke-width="1.5" stroke-dasharray="5 3"/>
        <line x1="112" y1="55" x2="168" y2="55" stroke="#DDD6CA" stroke-width="1.5"/>
        <line x1="112" y1="68" x2="158" y2="68" stroke="#DDD6CA" stroke-width="1.5"/>
        <line x1="112" y1="81" x2="163" y2="81" stroke="#DDD6CA" stroke-width="1"/>
      </svg>`;
    }
  }

  function formatTimeAgo(dateStr) {
    if (!dateStr) return '';
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // ── New design ─────────────────────────────────────────────────
  async function newDesign() {
    try {
      const resp = await fetch('/api/card-designer/designs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Design', status: 'in-development' }),
      });
      const d = await resp.json();
      if (!resp.ok) throw new Error(d.error || `Server error ${resp.status}`);
      designs.unshift(d);
      activeDesign = d;
      showWorkspaceView();
      showWorkspace();
    } catch (e) {
      alert(`Failed to create design: ${e.message}`);
    }
  }

  // ── Select design ──────────────────────────────────────────────
  async function selectDesign(id) {
    // Render immediately with cached data to avoid perceived lag
    const cached = designs.find(d => d.id === id);
    if (cached) {
      activeDesign = cached;
      showWorkspaceView();
      showWorkspace();
    }
    // Fetch full data in background (may include rounds not in list response)
    try {
      const resp = await fetch(`/api/card-designer/designs/${id}`);
      const full = await resp.json();
      if (!resp.ok) return;
      activeDesign = full;
      designs = designs.map(d => d.id === id ? full : d);
      showWorkspace(); // refresh with full round data
    } catch (e) {
      console.error('[card-designer] selectDesign fetch error:', e.message);
    }
  }

  // ── Workspace ──────────────────────────────────────────────────
  function showWorkspace() {
    // Design name
    const nameInput = qs('#cd-design-name');
    if (nameInput) nameInput.value = activeDesign.name || '';

    // Brief meta
    const metaEl = qs('#cd-brief-meta');
    if (metaEl) {
      const ago = activeDesign.updated_at ? 'edited ' + formatTimeAgo(activeDesign.updated_at) : '';
      metaEl.textContent = ago ? `Draft · ${ago}` : 'Draft';
    }

    // Product title field
    const productTitleEl = qs('#cd-product-title');
    if (productTitleEl) productTitleEl.value = activeDesign.product_title || activeDesign.product_data?.name || activeDesign.sku || '';

    // Creative direction
    const directionEl = qs('#cd-creative-direction');
    if (directionEl) directionEl.value = activeDesign.notes || '';

    // Character selector
    const charSel = qs('#cd-char-select');
    if (charSel && activeDesign.character_id) charSel.value = activeDesign.character_id;

    // Art style visual grid selection
    applyStyleSelection(activeDesign.art_style_id || null);

    // Reset ephemeral state
    sketchUrls   = [];
    conceptUrls  = [];
    sketchVotes  = [{}, {}, {}];
    conceptVotes = [{}, {}, {}];

    updateSidebarMeta();
    renderCopyRounds();
    renderSketchRounds();
    clearRightCard();

    // Restore last active module for this card (defaults to 'copy')
    switchModule(lsGet(activeDesign.id, 'active_module', 'copy'));
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
    if (activeDesign) lsSet(activeDesign.id, 'active_module', name);

    // Toggle all .cd-module-tab elements (includes .cd-step-row and .cd-track-tab)
    document.querySelectorAll('.cd-module-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.module === name)
    );

    // Show/hide module content panels
    document.querySelectorAll('.cd-module').forEach(m => {
      const isTarget = m.id === `cd-module-${name}`;
      m.classList.toggle('hidden', !isTarget);
      m.classList.toggle('active', isTarget);
    });

    const isSketch = name === 'sketch';
    qs('#cd-brief-fidelity')?.classList.toggle('hidden', !isSketch);
    qs('#cd-refine-bar')?.classList.toggle('hidden', !isSketch);
    if (isSketch) updateRefineBar();

    // Update regen button label based on active module
    const regenBtn = qs('#cd-regen-btn');
    if (regenBtn) {
      if (name === 'copy') regenBtn.textContent = '✨ Regenerate copy';
      else if (name === 'sketch') regenBtn.textContent = '✨ Generate sketches';
      else regenBtn.textContent = '✨ Generate concepts';
    }
  }

  // ── Save design name + notes ───────────────────────────────────
  async function saveMeta() {
    if (!activeDesign) return;
    const name          = (qs('#cd-design-name')?.value || '').trim() || 'Untitled Design';
    const notes         = qs('#cd-creative-direction')?.value || '';
    const product_title = qs('#cd-product-title')?.value || '';
    const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, notes, product_title }),
    });
    activeDesign = await resp.json();
    designs = designs.map(d => d.id === activeDesign.id ? activeDesign : d);
    renderDesignList();
    // Update brief meta timestamp
    const metaEl = qs('#cd-brief-meta');
    if (metaEl) {
      const ago = activeDesign.updated_at ? 'edited ' + formatTimeAgo(activeDesign.updated_at) : '';
      metaEl.textContent = ago ? `Draft · ${ago}` : 'Draft';
    }
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

    // Update picker display
    const skuBadge = qs('#cd-sku-badge');
    const skuName  = qs('#cd-sku-name');
    if (skuBadge) skuBadge.textContent = prod.sku || '';
    if (skuName)  skuName.textContent  = prod.name || prod.sku;

    // Hide the search inner panel
    qs('#cd-product-search-inner')?.classList.add('hidden');
    qs('#cd-product-dropdown')?.classList.add('hidden');

    // Update design name input if it changed
    const nameInput = qs('#cd-design-name');
    if (nameInput) nameInput.value = activeDesign.name || '';

    renderDesignList();
  }

  // ── Copy Generator (round-based) ───────────────────────────────
  async function generateCopyRound() {
    if (!activeDesign) return;
    // Only run for copy module — if another module is active, delegate
    const activeModule = lsGet(activeDesign.id, 'active_module', 'copy');
    if (activeModule === 'sketch') { generateSketchRound(); return; }
    if (activeModule === 'concept') { generateConcept(); return; }

    const btn = qs('#cd-regen-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating…'; }

    const count        = parseInt(qs('.cd-gen-n.active')?.dataset.count || '3', 10);
    const direction    = qs('#cd-creative-direction')?.value || '';
    const character_id = qs('#cd-char-select')?.value        || '';
    const art_style_id = selectedStyleId                     || '';
    const feedback     = buildCopyRoundFeedback();

    try {
      const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}/generate-copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ direction, count, character_id, art_style_id, feedback }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Generation failed');
      // Server may return updated design or just the round — handle both
      if (data.design) {
        activeDesign = data.design;
      } else if (data.copy_rounds) {
        activeDesign = { ...activeDesign, copy_rounds: data.copy_rounds };
      } else if (data.options) {
        // Backwards-compat: wrap flat options in a round structure
        const existingRounds = activeDesign.copy_rounds || [];
        activeDesign = {
          ...activeDesign,
          copy_rounds: [...existingRounds, { id: Date.now(), cards: data.options.map((o, i) => ({ id: `${Date.now()}-${i}`, ...o })) }],
        };
      }
      designs = designs.map(d => d.id === activeDesign.id ? activeDesign : d);
      renderCopyRounds();
      updateSidebarMeta();
    } catch (e) {
      alert(`Copy generation failed: ${e.message}`);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '✨ Regenerate copy'; }
    }
  }

  // ── Legacy copy generator (single-round flat) ──────────────────
  async function generateCopy() {
    // Delegate to round-based generator
    return generateCopyRound();
  }

  function buildCopyFeedback() {
    return null; // legacy — use buildCopyRoundFeedback for round-based flow
  }

  function buildCopyRoundFeedback() {
    const rounds = activeDesign?.copy_rounds || [];
    if (!rounds.length) return null;
    const liked_examples = [];
    const disliked_notes = [];
    for (const r of rounds) {
      for (const card of (r.cards || [])) {
        if (card.vote === 'up') liked_examples.push(card);
        if (card.vote === 'down' && card.note) disliked_notes.push(card.note);
      }
    }
    if (!liked_examples.length && !disliked_notes.length) return null;
    return { liked_examples, disliked_notes };
  }

  function renderCopyOptions() {
    // Legacy shim — calls round-based renderer
    renderCopyRounds();
  }

  async function selectCopyOption(idx) {
    // Legacy shim — no-op in round-based flow
  }

  function renderCopyRounds() {
    if (!activeDesign) return;
    const rounds  = activeDesign.copy_rounds || [];
    const emptyEl = qs('#cd-copy-empty');
    const listEl  = qs('#cd-copy-rounds');
    if (!listEl) return;

    if (!rounds.length) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      listEl.innerHTML = '';
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');

    listEl.innerHTML = rounds.map((round, ri) => {
      const isLatest = ri === rounds.length - 1;
      const cards    = round.cards || [];
      const dotClass = isLatest ? 'cd-round-dot' : 'cd-round-dot muted';
      const roundClass = isLatest ? 'cd-round' : 'cd-round muted-round';
      const timeLabel = round.created_at ? formatTimeAgo(round.created_at).toUpperCase() : '';
      const roundLabel = `ROUND ${ri + 1}${timeLabel ? ' · ' + timeLabel : ''}`;

      return `
        <div class="${roundClass}" data-round-id="${escAttr(round.id)}">
          <div class="cd-round-header">
            <span class="${dotClass}"></span>
            <span class="cd-round-label">${escHtml(roundLabel)}</span>
            ${round.refine_note ? `<span class="cd-round-note">${escHtml(round.refine_note)}</span>` : ''}
            <span class="cd-round-divider"></span>
          </div>
          <div class="cd-round-grid">
            ${cards.map((card, ci) => copyCardHtml(card, ci, round.id)).join('')}
          </div>
        </div>
      `;
    }).join('');

    // Bind events for copy cards
    listEl.querySelectorAll('.cd-copy-card').forEach(cardEl => {
      const cardId  = cardEl.dataset.cardId;
      const roundId = cardEl.closest('.cd-round')?.dataset.roundId;

      // Vote buttons
      cardEl.querySelector('.cd-copy-vote-up')?.addEventListener('click', () => {
        toggleCopyVote(roundId, cardId, 'up');
      });
      cardEl.querySelector('.cd-copy-vote-dn')?.addEventListener('click', () => {
        toggleCopyVote(roundId, cardId, 'down');
      });

      // Note input
      cardEl.querySelector('.cd-copy-note-input')?.addEventListener('input', e => {
        patchCopyCard(roundId, cardId, { note: e.target.value });
      });

      // Pick button
      cardEl.querySelector('.cd-copy-pick-btn')?.addEventListener('click', () => {
        selectCopyFromRound(roundId, cardId);
      });
    });
  }

  function copyCardHtml(card, cardIdx, roundId) {
    const isSelected = activeDesign?.selected_copy_id === card.id;
    const voteUp   = card.vote === 'up';
    const voteDn   = card.vote === 'down';
    return `
      <div class="cd-copy-card${isSelected ? ' selected' : ''}" data-card-id="${escAttr(card.id)}" data-round-id="${escAttr(roundId)}">
        <div class="cd-copy-card-hdr">
          <div class="cd-copy-card-hdr-left">
            <span class="cd-copy-opt-label">OPTION ${cardIdx + 1}</span>
            ${isSelected ? '<span class="cd-copy-selected-badge">SELECTED</span>' : ''}
          </div>
          <div class="cd-copy-vote-btns">
            <button class="cd-copy-vote-btn cd-copy-vote-up${voteUp ? ' up-active' : ''}" title="Like">👍</button>
            <button class="cd-copy-vote-btn cd-copy-vote-dn${voteDn ? ' down-active' : ''}" title="Dislike">👎</button>
          </div>
        </div>
        <div class="cd-copy-card-body">
          ${card.cover       ? `<div><div class="cd-copy-field-lbl">Cover</div><div class="cd-copy-field-cover">${escHtml(card.cover)}</div></div>` : ''}
          ${card.inside_left ? `<div><div class="cd-copy-field-lbl">Inside Left</div><div class="cd-copy-field-il">${escHtml(card.inside_left)}</div></div>` : ''}
          ${card.inside_right? `<div><div class="cd-copy-field-lbl">Inside Right</div><div class="cd-copy-field-ir">${escHtml(card.inside_right)}</div></div>` : ''}
          ${card.sculpture   ? `<div><div class="cd-copy-field-lbl">Sculpture</div><div class="cd-copy-field-sc">${escHtml(card.sculpture)}</div></div>` : ''}
        </div>
        <div class="cd-copy-card-footer">
          <input type="text" class="cd-copy-note-input${card.note ? ' has-note' : ''}" placeholder="Note for next round…" value="${escAttr(card.note || '')}" />
          <button class="cd-copy-pick-btn${isSelected ? ' picked' : ''}">
            ${isSelected ? '✓ Final' : 'Select as final'}
          </button>
        </div>
      </div>
    `;
  }

  function toggleCopyVote(roundId, cardId, voteType) {
    if (!activeDesign) return;
    const rounds = activeDesign.copy_rounds || [];
    for (const r of rounds) {
      if (r.id !== roundId) continue;
      const card = (r.cards || []).find(c => c.id === cardId);
      if (card) {
        card.vote = card.vote === voteType ? null : voteType;
        break;
      }
    }
    renderCopyRounds();
  }

  function patchCopyCard(roundId, cardId, updates) {
    if (!activeDesign) return;
    const rounds = activeDesign.copy_rounds || [];
    for (const r of rounds) {
      if (r.id !== roundId) continue;
      const card = (r.cards || []).find(c => c.id === cardId);
      if (card) { Object.assign(card, updates); break; }
    }
  }

  async function selectCopyFromRound(roundId, cardId) {
    if (!activeDesign) return;
    let selectedCard = null;
    for (const r of (activeDesign.copy_rounds || [])) {
      selectedCard = (r.cards || []).find(c => c.id === cardId);
      if (selectedCard) break;
    }
    if (!selectedCard) return;

    try {
      const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected_copy: selectedCard, selected_copy_id: cardId }),
      });
      activeDesign = await resp.json();
      designs = designs.map(d => d.id === activeDesign.id ? activeDesign : d);
      renderCopyRounds();
      updateSidebarMeta();
    } catch (e) {
      console.error('[copy] selectCopyFromRound error:', e.message);
    }
  }

  // ── Sketch Module ──────────────────────────────────────────────

  // Tracks which sketch card is focused in the right panel
  let focusedSketchCard = null;

  function renderBriefSidebar() {
    // Legacy shim — delegates to updateSidebarMeta
    updateSidebarMeta();
  }

  function updateSidebarMeta() {
    if (!activeDesign) return;

    // Module progress / step row meta
    const copyRounds    = (activeDesign.copy_rounds    || []).length;
    const sketchRounds  = (activeDesign.sketch_rounds  || []).length;
    const conceptRounds = (activeDesign.concept_rounds || []).length;

    const prog = activeDesign.progress || ['empty', 'empty', 'empty'];
    const copyDone    = prog[0] === 'done';
    const sketchDone  = prog[1] === 'done';
    const conceptDone = prog[2] === 'done';

    // Step metas
    const copyMetaEl = qs('#cd-step-meta-copy');
    if (copyMetaEl) copyMetaEl.textContent = copyRounds > 0 ? `${copyRounds} round${copyRounds !== 1 ? 's' : ''}` : 'Not started';
    const sketchMetaEl = qs('#cd-step-meta-sketch');
    if (sketchMetaEl) sketchMetaEl.textContent = sketchRounds > 0 ? `${sketchRounds} round${sketchRounds !== 1 ? 's' : ''}` : 'Not started';
    const conceptMetaEl = qs('#cd-step-meta-concept');
    if (conceptMetaEl) conceptMetaEl.textContent = conceptRounds > 0 ? `${conceptRounds} round${conceptRounds !== 1 ? 's' : ''}` : 'Not started';

    // Step icons — show ✓ when done
    const updateStepIcon = (iconId, done, defaultText) => {
      const iconEl = qs(iconId);
      if (!iconEl) return;
      iconEl.classList.toggle('done', done);
      iconEl.textContent = done ? '✓' : defaultText;
    };
    updateStepIcon('#cd-step-icon-copy',    copyDone,    'T');
    updateStepIcon('#cd-step-icon-sketch',  sketchDone,  '◈');
    updateStepIcon('#cd-step-icon-concept', conceptDone, '✦');

    // Mod check marks
    const setCheck = (id, done) => { const el = qs(id); if (el) el.textContent = done ? '✓' : ''; };
    setCheck('#cd-mod-check-copy',    copyDone);
    setCheck('#cd-mod-check-sketch',  sketchDone);
    setCheck('#cd-mod-check-concept', conceptDone);

    // Fidelity — restore from localStorage
    const savedFidelity = lsGet(activeDesign.id, 'fidelity', 'standard');
    applyFidelityUI(savedFidelity);
  }

  function setFidelity(level) {
    if (activeDesign) lsSet(activeDesign.id, 'fidelity', level);
    applyFidelityUI(level);
  }

  function applyFidelityUI(level) {
    document.querySelectorAll('.cd-fidelity-stop').forEach(s => {
      s.classList.toggle('active', s.dataset.fidelity === level);
    });
    const descs = {
      loose:    'Free-flowing exploration sketch.',
      standard: 'Clean architectural sketch with clear fold lines.',
      tight:    'Precise technical drawing with detailed dimensions.',
    };
    const descEl = qs('#cd-fidelity-desc');
    if (descEl) descEl.textContent = descs[level] || '';
  }

  function renderSketchRounds() {
    if (!activeDesign) return;
    const rounds  = activeDesign.sketch_rounds || [];
    const emptyEl = qs('#cd-sketch-empty');
    const listEl  = qs('#cd-sketch-rounds');
    if (!emptyEl || !listEl) return;

    if (!rounds.length) {
      emptyEl.classList.remove('hidden');
      listEl.innerHTML = '';
      return;
    }

    emptyEl.classList.add('hidden');
    listEl.innerHTML = rounds.map((round, ri) => {
      const cards = round.cards || [];
      return `
        <div class="cd-round" data-round-id="${escAttr(round.id)}">
          <div class="cd-round-header">
            <span class="cd-round-label">Round ${ri + 1}</span>
            ${round.refine_note ? `<span class="cd-round-note">${escHtml(round.refine_note)}</span>` : ''}
          </div>
          <div class="cd-round-grid">
            ${cards.map(card => sketchCardHtml(card)).join('')}
          </div>
        </div>
      `;
    }).join('');

    // Bind card interactions
    listEl.querySelectorAll('.cd-sk-card').forEach(cardEl => {
      const cardId  = cardEl.dataset.cardId;
      const roundId = cardEl.closest('.cd-round')?.dataset.roundId;

      cardEl.querySelector('.cd-sk-vote-pin')?.addEventListener('click', e => {
        e.stopPropagation();
        toggleSketchVote(cardId, 'pin');
      });
      cardEl.querySelector('.cd-sk-vote-dis')?.addEventListener('click', e => {
        e.stopPropagation();
        toggleSketchVote(cardId, 'dislike');
      });

      // Click card to focus in right panel
      cardEl.addEventListener('click', () => {
        const allRounds = activeDesign.sketch_rounds || [];
        let found = null;
        for (const r of allRounds) {
          found = (r.cards || []).find(c => c.id === cardId);
          if (found) break;
        }
        if (found) showRightCard(found);
      });
    });
  }

  function sketchCardHtml(card) {
    const isPinned   = card.vote === 'pin';
    const isDisliked = card.vote === 'dislike';
    const classes = ['cd-sk-card', isPinned ? 'pinned' : '', isDisliked ? 'disliked' : ''].filter(Boolean).join(' ');
    return `
      <div class="${classes}" data-card-id="${escAttr(card.id)}">
        <img src="${escAttr(card.url)}" class="cd-sk-card-img" loading="lazy" alt="Sketch" />
        <div class="cd-sk-card-footer">
          <button class="cd-sk-vote-btn cd-sk-vote-pin${isPinned ? ' active' : ''}" title="Pin">📌</button>
          <button class="cd-sk-vote-btn cd-sk-vote-dis${isDisliked ? ' active' : ''}" title="Dislike">👎</button>
        </div>
      </div>
    `;
  }

  async function toggleSketchVote(cardId, voteType) {
    if (!activeDesign) return;
    const allRounds = activeDesign.sketch_rounds || [];
    let currentVote = null;
    for (const r of allRounds) {
      const c = (r.cards || []).find(c => c.id === cardId);
      if (c) { currentVote = c.vote; break; }
    }

    // Toggle: if same vote, clear it; otherwise set new vote
    const newVote = currentVote === voteType ? null : voteType;
    await patchSketchCard(cardId, { vote: newVote });
  }

  async function patchSketchCard(cardId, updates) {
    if (!activeDesign) return;
    try {
      const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}/sketch/card/${cardId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Update failed');
      activeDesign = data;
      designs = designs.map(d => d.id === activeDesign.id ? activeDesign : d);
      renderSketchRounds();
      updateRefineBar();
      // Refresh right panel if the patched card is currently shown
      if (focusedSketchCard?.id === cardId) {
        const updated = findSketchCard(cardId);
        if (updated) showRightCard(updated);
      }
    } catch (e) {
      console.error('[sketch] patchSketchCard error:', e.message);
    }
  }

  function findSketchCard(cardId) {
    for (const r of (activeDesign?.sketch_rounds || [])) {
      const c = (r.cards || []).find(c => c.id === cardId);
      if (c) return c;
    }
    return null;
  }

  function showRightCard(card) {
    focusedSketchCard = card;
    qs('#cd-right-empty')?.classList.add('hidden');
    const cardEl = qs('#cd-right-card');
    if (!cardEl) return;
    cardEl.classList.remove('hidden');
    cardEl.dataset.cardId = card.id;

    const img = qs('#cd-right-img');
    if (img) img.src = card.url;

    const note = qs('#cd-right-note');
    if (note) {
      note.value = card.note || '';
      note.oninput = () => {
        patchSketchCard(card.id, { note: note.value });
      };
    }

    // Highlight focused card in grid
    document.querySelectorAll('.cd-sk-card').forEach(el => {
      el.classList.toggle('focused', el.dataset.cardId === card.id);
    });

    // Show "Select as final" button in refine bar
    qs('#cd-sketch-final-btn')?.classList.remove('hidden');
  }

  function clearRightCard() {
    focusedSketchCard = null;
    qs('#cd-right-empty')?.classList.remove('hidden');
    qs('#cd-right-card')?.classList.add('hidden');
    document.querySelectorAll('.cd-sk-card').forEach(el => el.classList.remove('focused'));
    qs('#cd-sketch-final-btn')?.classList.add('hidden');
  }

  function updateRefineBar() {
    if (!activeDesign) return;
    const allRounds = activeDesign.sketch_rounds || [];
    const allCards  = allRounds.flatMap(r => r.cards || []);
    const pinned    = allCards.filter(c => c.vote === 'pin').length;
    const disliked  = allCards.filter(c => c.vote === 'dislike').length;

    const chipsEl = qs('#cd-refine-chips');
    if (chipsEl) {
      const parts = [];
      if (pinned   > 0) parts.push(`<span class="cd-refine-chip cd-refine-chip-pin">📌 ${pinned} pinned</span>`);
      if (disliked > 0) parts.push(`<span class="cd-refine-chip cd-refine-chip-dis">👎 ${disliked} disliked</span>`);
      chipsEl.innerHTML = parts.join('');
    }

    const nextRound = allRounds.length + 1;
    const btn = qs('#cd-sketch-generate-btn');
    if (btn) btn.textContent = `Generate Round ${nextRound} →`;
  }

  async function generateSketchRound() {
    if (!activeDesign) return;
    const btn         = qs('#cd-sketch-generate-btn');
    const refineInput = qs('#cd-refine-input');
    const refine_note = refineInput?.value?.trim() || '';
    const fidelity    = lsGet(activeDesign.id, 'fidelity', 'standard');
    const allRounds   = activeDesign.sketch_rounds || [];
    const roundNum    = allRounds.length + 1;

    // Pin a parent card if one is focused and pinned
    const parent_card_id = focusedSketchCard?.vote === 'pin' ? focusedSketchCard.id : null;

    if (btn) { btn.disabled = true; btn.textContent = `⏳ Generating Round ${roundNum}…`; }

    // Show skeleton placeholders
    const emptyEl = qs('#cd-sketch-empty');
    const listEl  = qs('#cd-sketch-rounds');
    if (emptyEl) emptyEl.classList.add('hidden');
    if (listEl) {
      const skeleton = document.createElement('div');
      skeleton.className = 'cd-round cd-round-skeleton';
      skeleton.innerHTML = `
        <div class="cd-round-header"><span class="cd-round-label">Round ${roundNum}</span></div>
        <div class="cd-round-grid">
          <div class="cd-sk-card cd-sk-card-skeleton"><div class="cd-sk-card-img-placeholder"></div></div>
          <div class="cd-sk-card cd-sk-card-skeleton"><div class="cd-sk-card-img-placeholder"></div></div>
          <div class="cd-sk-card cd-sk-card-skeleton"><div class="cd-sk-card-img-placeholder"></div></div>
        </div>`;
      listEl.appendChild(skeleton);
      skeleton.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    try {
      const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}/sketch/round`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refine_note, fidelity, count: 3, parent_card_id }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Generation failed');
      activeDesign = data.design;
      designs = designs.map(d => d.id === activeDesign.id ? activeDesign : d);
      if (refineInput) refineInput.value = '';
    } catch (e) {
      alert(`Sketch generation failed: ${e.message}`);
      if (emptyEl && !(activeDesign.sketch_rounds || []).length) emptyEl.classList.remove('hidden');
    } finally {
      renderSketchRounds();
      updateRefineBar();
      if (btn) btn.disabled = false;
    }
  }

  async function promoteSketch() {
    if (!activeDesign || !focusedSketchCard) {
      alert('Click a sketch to select it, then click "Select as final".');
      return;
    }
    const btn = qs('#cd-sketch-final-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Saving…'; }
    try {
      const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}/promote-sketch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_id: focusedSketchCard.id }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Promote failed');
      // promote-sketch route returns the design directly (not wrapped)
      activeDesign = data;
      designs = designs.map(d => d.id === activeDesign.id ? activeDesign : d);
      renderBriefSidebar();
      renderSelectedSketch();
      // Visual feedback — update button label then restore
      if (btn) { btn.textContent = '✓ Saved!'; }
      setTimeout(() => { if (btn) { btn.disabled = false; btn.textContent = '✓ Select as final'; } }, 1500);
    } catch (e) {
      alert(`Could not select sketch: ${e.message}`);
      if (btn) { btn.disabled = false; btn.textContent = '✓ Select as final'; }
    }
  }

  async function refineRightCard() {
    if (!focusedSketchCard) return;
    // Pin the focused card then trigger a new round
    await patchSketchCard(focusedSketchCard.id, { vote: 'pin' });
    const refineInput = qs('#cd-refine-input');
    if (refineInput) refineInput.focus();
  }

  // ── Detailed Concept ───────────────────────────────────────────
  async function generateConcept() {
    if (!activeDesign) return;
    const btn       = qs('#cd-regen-btn');
    const container = qs('#cd-concept-rounds');
    setGenerating(btn, container, '⏳ Generating concepts…', 'Generating 3 detailed concepts via Gemini… (this may take up to 30s per image)');

    const direction    = qs('#cd-creative-direction')?.value || '';
    const character_id = qs('#cd-char-select')?.value         || '';
    const art_style_id = selectedStyleId                      || '';
    const feedback     = buildImageFeedback(conceptVotes, conceptUrls);

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
      resetBtn(btn, '✨ Generate concepts');
    }
  }

  function buildImageFeedback(votes, urls) {
    const liked_urls     = votes.map((v, i) => v.up   && urls[i] ? urls[i]  : null).filter(Boolean);
    const disliked_notes = votes.map(v       => v.down && v.note ? v.note   : null).filter(Boolean);
    return (liked_urls.length || disliked_notes.length) ? { liked_urls, disliked_notes } : null;
  }

  function renderImageOptions(type) {
    const isSketch    = type === 'sketch';
    const urls        = isSketch ? sketchUrls   : conceptUrls;
    const votes       = isSketch ? sketchVotes  : conceptVotes;
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

      // Character — keep as <select>
      const charSel = qs('#cd-char-select');
      if (charSel && Array.isArray(characters)) {
        characters.forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.id;
          opt.textContent = c.name || `Character #${c.id}`;
          charSel.appendChild(opt);
        });
      }

      // Art style — populate modal grid
      const modalGrid = qs('#cd-style-modal-grid');
      if (modalGrid && Array.isArray(artStyles)) {
        artStyles.forEach(s => {
          const tile = document.createElement('button');
          tile.type = 'button';
          tile.className = 'cd-style-modal-tile';
          tile.dataset.styleId = s.id;
          const img = (s.images || [])[0] || (s.sample_images || [])[0] || null;
          tile.innerHTML = `
            <div class="cd-style-modal-tile-img-wrap">
              ${img
                ? `<img src="${escAttr(img)}" class="cd-style-modal-tile-img" alt="${escHtml(s.name || '')}" loading="lazy" />`
                : `<div class="cd-style-modal-tile-placeholder">${escHtml((s.name || '?').charAt(0).toUpperCase())}</div>`}
            </div>
            <div class="cd-style-modal-tile-name">${escHtml(s.name || `Style ${s.id}`)}</div>
          `;
          tile.addEventListener('click', () => selectStyleInModal(s.id, s));
          modalGrid.appendChild(tile);
        });
      }
    } catch (e) {
      console.warn('[card-designer] loadConceptSelectors error:', e.message);
    }
  }

  // ── Art style modal state ──────────────────────────────────────
  let pendingStyleId   = null;  // selection in-progress inside modal
  let pendingStyleData = null;  // { id, name, img } for the pending pick

  function openStyleModal() {
    // Sync modal selection to current value
    pendingStyleId   = selectedStyleId;
    pendingStyleData = null;
    syncModalSelection(selectedStyleId);
    qs('#cd-style-modal')?.classList.remove('hidden');
  }

  function closeStyleModal() {
    qs('#cd-style-modal')?.classList.add('hidden');
  }

  function selectStyleInModal(id, styleObj) {
    pendingStyleId = id || null;
    pendingStyleData = styleObj || null;
    syncModalSelection(id);
  }

  function syncModalSelection(id) {
    document.querySelectorAll('.cd-style-modal-tile').forEach(tile => {
      tile.classList.toggle('active', tile.dataset.styleId == (id || ''));
    });
    const noneEl = qs('#cd-style-modal-none');
    if (noneEl) noneEl.classList.toggle('active', !id);
  }

  function confirmStyleSelection() {
    selectArtStyle(pendingStyleId, pendingStyleData);
    closeStyleModal();
  }

  function selectArtStyle(id, styleObj) {
    selectedStyleId = id || null;
    applyStylePickerDisplay(selectedStyleId, styleObj);
    // Persist to design
    if (activeDesign) {
      fetch(`/api/card-designer/designs/${activeDesign.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ art_style_id: selectedStyleId }),
      }).then(r => r.json()).then(d => {
        activeDesign = d;
        designs = designs.map(x => x.id === d.id ? d : x);
      }).catch(e => console.warn('[card-designer] selectArtStyle save error:', e.message));
    }
  }

  function applyStylePickerDisplay(id, styleObj) {
    const thumbEl = qs('#cd-style-picker-thumb');
    const nameEl  = qs('#cd-style-picker-name');
    if (!id) {
      if (thumbEl) thumbEl.style.backgroundImage = '';
      if (nameEl)  nameEl.textContent = 'None selected';
      return;
    }
    // Find style data in modal grid if not passed
    if (!styleObj) {
      const tile = qs(`#cd-style-modal-grid [data-style-id="${id}"]`);
      if (tile) {
        const img = tile.querySelector('img');
        const name = tile.querySelector('.cd-style-modal-tile-name')?.textContent || '';
        if (thumbEl && img) thumbEl.style.backgroundImage = `url(${img.src})`;
        if (nameEl) nameEl.textContent = name;
        return;
      }
    }
    const img = (styleObj?.images || [])[0] || (styleObj?.sample_images || [])[0] || null;
    if (thumbEl) thumbEl.style.backgroundImage = img ? `url(${img})` : '';
    if (nameEl)  nameEl.textContent = styleObj?.name || `Style ${id}`;
  }

  function applyStyleSelection(id) {
    selectedStyleId = id || null;
    applyStylePickerDisplay(selectedStyleId, null);
    syncModalSelection(selectedStyleId);
  }

  // ── Settings ───────────────────────────────────────────────────
  async function loadCDSettings() {
    try {
      const resp = await fetch('/api/settings');
      const s    = await resp.json();
      setVal('#cd-s-gemini-key',           s.gemini_api_key                  || '');
      setVal('#cd-s-gemini-model',         s.gemini_model                    || 'gemini-3.1-flash-image-preview');
      setVal('#cd-s-copy-cover',           s.cd_copy_instruction_cover       || '');
      setVal('#cd-s-copy-inside-left',     s.cd_copy_instruction_inside_left || '');
      setVal('#cd-s-copy-inside-right',    s.cd_copy_instruction_inside_right|| '');
      setVal('#cd-s-copy-sculpture',       s.cd_copy_instruction_sculpture   || '');
      setVal('#cd-s-copy-back',            s.cd_copy_instruction_back        || '');
      setVal('#cd-s-sketch-prompt',        s.cd_sketch_system_prompt         || '');
      setVal('#cd-s-sketch-sample-images', s.cd_sketch_sample_images         || '');
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
      gemini_model:                     getVal('#cd-s-gemini-model'),
      cd_copy_instruction_cover:        getVal('#cd-s-copy-cover'),
      cd_copy_instruction_inside_left:  getVal('#cd-s-copy-inside-left'),
      cd_copy_instruction_inside_right: getVal('#cd-s-copy-inside-right'),
      cd_copy_instruction_sculpture:    getVal('#cd-s-copy-sculpture'),
      cd_copy_instruction_back:         getVal('#cd-s-copy-back'),
      cd_sketch_system_prompt:          getVal('#cd-s-sketch-prompt'),
      cd_sketch_sample_images:          getVal('#cd-s-sketch-sample-images'),
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
      // Update badge immediately after save
      const badge = qs('#gemini-key-status-badge');
      if (badge) { badge.className = 'api-key-badge configured'; badge.textContent = '✓ Gemini Key Configured'; }
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

  // ── URL Routing ────────────────────────────────────────────────
  // This is an SPA — Express serves index.html for all paths via its * fallback.
  // We use history.pushState so each card gets a shareable /card-designer/:id URL.
  function initRouting() {
    const cardMatch = window.location.pathname.match(/^\/card-designer\/([a-zA-Z0-9_-]+)$/);
    if (cardMatch) {
      const targetId = cardMatch[1];
      // Programmatically activate the card-designer tab and view
      if (typeof switchView === 'function') switchView('card-designer');
      loadConceptSelectors();
      loadDesigns().then(() => selectDesign(targetId));
    }

    window.addEventListener('popstate', () => {
      if (typeof switchView === 'function') switchView('card-designer');
      const m = window.location.pathname.match(/^\/card-designer\/([a-zA-Z0-9_-]+)$/);
      if (m) {
        loadDesigns().then(() => selectDesign(m[1]));
      } else {
        showDashboard();
      }
    });
  }

  // ── Init ───────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
