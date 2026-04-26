/* Card Designer Module — fully self-contained, no app.js dependencies */
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────
  let designs = [];
  let activeDesign = null;
  let allProducts = null;
  let selectedStyleId = null;   // art style visual grid
  let selectedCharId  = null;   // character modal selection

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
  let iteratingSketchCardId   = null;  // card being iterated in Inside Sketch
  let iteratingCoverSketchCardId = null; // card being iterated in Cover Sketch

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

    // Character picker modal
    qs('#cd-char-picker-btn')?.addEventListener('click', openCharModal);
    qs('#cd-char-modal-close')?.addEventListener('click', closeCharModal);
    qs('#cd-char-modal-cancel')?.addEventListener('click', closeCharModal);
    qs('#cd-char-modal-confirm')?.addEventListener('click', confirmCharSelection);
    qs('#cd-char-modal-none')?.addEventListener('click', () => selectCharInModal(null, null));
    qs('#cd-char-modal')?.addEventListener('click', e => {
      if (e.target === qs('#cd-char-modal')) closeCharModal();
    });

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

    // Cover sketch generate
    qs('#cd-cover-sketch-generate-btn')?.addEventListener('click', generateCoverSketchRound);

    // Product format auto-save on change
    qs('#cd-product-format')?.addEventListener('change', saveProductFormat);

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

    // Gemini key save (inline key field in settings)
    qs('#cd-gemini-key-save-btn')?.addEventListener('click', saveGeminiKey);

    // Sculpture reference drop zone
    initSculptureRefZone();

    // Cover ref zone
    initCoverRefZone();

    // Cover style picker
    qs('#cd-cover-style-select')?.addEventListener('change', e => onCoverStyleChange(e.target.value));

    // Exit button (top-right of track bar)
    qs('#cd-exit-btn')?.addEventListener('click', showDashboard);

    // Concept generate button
    qs('#cd-concept-generate-btn')?.addEventListener('click', generateConcept);

    // Blank card checkbox
    qs('#cd-blank-card-check')?.addEventListener('change', async (e) => {
      if (!activeDesign) return;
      const val = e.target.checked ? 1 : 0;
      activeDesign = await fetch(`/api/card-designer/designs/${activeDesign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_blank_card: val }),
      }).then(r => r.json());
      designs = designs.map(d => d.id === activeDesign.id ? activeDesign : d);
      renderCopyRounds();
      updateRegenBtn('copy');
      renderSelectedCopyBrief();
      updateNextStepBtn('copy');
    });

    // Next step button
    qs('#cd-next-step-btn')?.addEventListener('click', nextStep);

    // Export design spec
    qs('#cd-export-spec-btn')?.addEventListener('click', exportDesignSpec);

    // Auto-save finalize notes/comments
    qs('#cd-finalize-notes')?.addEventListener('blur', saveFinalizeNotes);
    qs('#cd-finalize-comments')?.addEventListener('blur', saveFinalizeNotes);

    // Copy editor confirm
    qs('#cd-copy-confirm-btn')?.addEventListener('click', confirmCopy);

    // Copy editor clear
    qs('#cd-copy-editor-clear')?.addEventListener('click', () => {
      ['#cd-copy-edit-cover','#cd-copy-edit-inside-left','#cd-copy-edit-inside-right','#cd-copy-edit-sculpture','#cd-copy-edit-back'].forEach(id => {
        const el = qs(id); if (el) el.value = '';
      });
      if (activeDesign) delete activeDesign._editing_copy_source_id;
      const panel = qs('#cd-copy-editor-panel');
      if (panel) { panel.classList.add('hidden'); delete panel.dataset.sourceCardId; }
      renderCopyRounds();
    });
  }

  function bindDashboardUI() {
    // New design buttons
    qs('#cd-new-btn')?.addEventListener('click', newDesign);
    qs('#cd-empty-new-btn')?.addEventListener('click', newDesign);

    // Back to dashboard (footer button + top breadcrumb)
    qs('#cd-back-btn')?.addEventListener('click', showDashboard);
    qs('#cd-back-btn-top')?.addEventListener('click', showDashboard);

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
      const data = await resp.json();
      designs = Array.isArray(data) ? data : [];
    } catch (e) {
      designs = [];
    }
    // Silently scrub any broken image references (files deleted after volume reset etc.)
    // Runs fire-and-forget; a second loadDesigns call refreshes tiles after scrub completes
    fetch('/api/card-designer/scrub-broken-images', { method: 'POST' })
      .then(r => r.json())
      .then(({ scrubbed }) => { if (scrubbed > 0) loadDesigns(); })
      .catch(() => {});
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

    const countBadgeEl = qs('#cd-dash-count');
    if (countBadgeEl) countBadgeEl.textContent = `${designs.length} design${designs.length !== 1 ? 's' : ''}`;

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
      tile.addEventListener('click', e => {
        if (e.target.closest('.cd-tile-delete-btn')) return; // don't open on delete click
        selectDesign(tile.dataset.id);
      });
    });
    grid.querySelectorAll('.cd-tile-delete-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        deleteDesign(btn.dataset.id, btn.dataset.name);
      });
    });
  }

  function progressScore(d) {
    return (d.progress || []).reduce((acc, s) => acc + (s === 'done' ? 2 : s === 'active' ? 1 : 0), 0);
  }

  function cardTileHtml(d) {
    const progress = d.progress || ['empty', 'empty', 'empty', 'empty'];
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
    const coverDone   = progress[2] === 'done';
    const conceptDone = progress[3] === 'done';

    const nodeLabels = ['Copy', 'Sketch', 'Cover', 'Concept'];
    const progressNodes = progress.map((s, i) => `
      <div class="cd-prog-node cd-prog-${s}" title="${nodeLabels[i]}">${s === 'done' ? '✓' : ''}</div>
    `).join('');
    const progressLabelHtml = nodeLabels.map((l, i) => `<span class="cd-prog-label cd-prog-label-${progress[i]}">${l}</span>`).join('');

    const charPill = d.character_name ? `<span class="cd-ctx-pill"><span class="cd-ctx-dot cd-ctx-dot-coral"></span>${escHtml(d.character_name)}</span>` : '';
    const stylePill = d.art_style_name ? `<span class="cd-ctx-pill"><span class="cd-ctx-dot cd-ctx-dot-grad"></span>${escHtml(d.art_style_name)}</span>` : '';

    // Progress summary text
    const hasCopySelected        = !!(d.selected_copy?.cover || d.selected_copy?.inside_left);
    const hasSketchSelected      = !!d.selected_sketch_url;
    const hasCoverSketchSelected = !!d.selected_cover_sketch_url;
    const hasConceptSelected     = !!d.selected_concept_url;
    const roundsText = hasConceptSelected ? 'Concept selected ✓'
      : hasSketchSelected ? 'Inside sketch selected ✓'
      : hasCoverSketchSelected ? 'Cover sketch selected ✓'
      : hasCopySelected ? 'Copy selected ✓'
      : (d.rounds_count || 0) > 0 ? `${d.rounds_count} round${d.rounds_count !== 1 ? 's' : ''} in progress`
      : 'No rounds yet';

    return `
      <div class="cd-card-tile" data-id="${escAttr(d.id)}">
        <div class="cd-tile-preview">
          ${tilePreviewImg(d)}
          <span class="cd-tile-status ${statusClass}">${escHtml(statusLabel)}</span>
          ${isReview ? '<div class="cd-tile-ribbon">READY FOR REVIEW</div>' : ''}
          <button class="cd-tile-delete-btn" data-id="${escAttr(d.id)}" data-name="${escAttr(d.name || 'this design')}" title="Delete design">✕</button>
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

  function tilePreviewImg(d) {
    // Prefer the most advanced selected image — concept → inside sketch → cover sketch — then fall back to SVG placeholder
    const imgUrl = d.selected_concept_url || d.selected_sketch_url || d.selected_cover_sketch_url || null;
    const progress   = d.progress || ['empty', 'empty', 'empty', 'empty'];
    const copyDone   = progress[0] === 'done';
    const sketchDone = progress[1] === 'done';
    const coverDone  = progress[2] === 'done';
    const conceptDone= progress[3] === 'done';
    const isDone     = d.status === 'complete';
    const svgFallback = tilePreviewSvg(d.id, copyDone, sketchDone, conceptDone, isDone);
    if (imgUrl) {
      // onerror: replace the broken img with the SVG fallback so missing files don't show as broken alt text
      const escapedSvg = svgFallback.replace(/`/g, '\\`').replace(/"/g, '&quot;');
      return `<img src="${escAttr(imgUrl)}" class="cd-tile-preview-img" alt="Design preview" loading="lazy"
        onerror="this.outerHTML=decodeURIComponent(this.dataset.fallback)" data-fallback="${encodeURIComponent(svgFallback)}" />`;
    }
    return svgFallback;
  }

  function tilePreviewSvg(id, copyDone, sketchDone, conceptDone, isDone) {
    const uid = `pg${id}`.replace(/[^a-z0-9]/gi, '');
    if (isDone || conceptDone) {
      return `<svg width="100%" height="160" viewBox="0 0 280 160" xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="${uid}" x1="0" y1="0" x2="280" y2="160" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#1B2A4A"/><stop offset="100%" stop-color="#3D5A99"/>
        </linearGradient></defs>
        <rect width="280" height="160" fill="url(#${uid})" rx="4"/>
        ${isDone
          ? '<circle cx="140" cy="80" r="28" fill="#2D9E5F" opacity="0.9"/><text x="140" y="88" text-anchor="middle" font-size="22" fill="white">✓</text>'
          : '<circle cx="140" cy="80" r="28" fill="white" opacity="0.08"/><text x="140" y="88" text-anchor="middle" font-size="22" fill="white" opacity="0.4">✦</text>'}
      </svg>`;
    } else if (sketchDone) {
      return `<svg width="100%" height="160" viewBox="0 0 280 160" xmlns="http://www.w3.org/2000/svg">
        <rect width="280" height="160" fill="#F7F4EF" rx="4"/>
        <g stroke="#1B2A4A" stroke-width="1" opacity="0.55">
          <line x1="80" y1="125" x2="200" y2="125"/>
          <line x1="90" y1="125" x2="140" y2="55" stroke-width="1.5"/>
          <line x1="190" y1="125" x2="140" y2="55" stroke-width="1.5"/>
          <line x1="100" y1="105" x2="180" y2="105"/>
          <line x1="110" y1="88" x2="170" y2="88"/>
        </g>
        <text x="140" y="148" text-anchor="middle" font-size="9" fill="#1B2A4A" opacity="0.35" font-family="monospace">CONCEPT SKETCH</text>
      </svg>`;
    } else if (copyDone) {
      return `<svg width="100%" height="160" viewBox="0 0 280 160" xmlns="http://www.w3.org/2000/svg">
        <rect width="280" height="160" fill="#FBF9F6" rx="4"/>
        <rect x="70" y="22" width="140" height="116" rx="5" fill="white" stroke="#E5DFD5" stroke-width="1.5"/>
        <line x1="90" y1="50" x2="190" y2="50" stroke="#C9BFB0" stroke-width="1.5"/>
        <line x1="90" y1="66" x2="190" y2="66" stroke="#C9BFB0" stroke-width="1.5"/>
        <line x1="90" y1="82" x2="165" y2="82" stroke="#C9BFB0" stroke-width="1.5"/>
        <line x1="90" y1="102" x2="178" y2="102" stroke="#E5DFD5" stroke-width="1"/>
        <line x1="90" y1="116" x2="152" y2="116" stroke="#E5DFD5" stroke-width="1"/>
      </svg>`;
    } else {
      return `<svg width="100%" height="160" viewBox="0 0 280 160" xmlns="http://www.w3.org/2000/svg">
        <rect width="280" height="160" fill="#F2EDE6" rx="4"/>
        <rect x="95" y="35" width="90" height="90" rx="5" fill="white" stroke="#DDD6CA" stroke-width="1.5" stroke-dasharray="5 3"/>
        <line x1="112" y1="62" x2="168" y2="62" stroke="#DDD6CA" stroke-width="1.5"/>
        <line x1="112" y1="77" x2="158" y2="77" stroke="#DDD6CA" stroke-width="1.5"/>
        <line x1="112" y1="92" x2="163" y2="92" stroke="#DDD6CA" stroke-width="1"/>
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

  // ── Delete design ──────────────────────────────────────────────
  async function deleteDesign(id, name) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    try {
      const resp = await fetch(`/api/card-designer/designs/${id}`, { method: 'DELETE' });
      if (!resp.ok) throw new Error('Server error');
      designs = designs.filter(d => d.id !== id);
      if (activeDesign?.id === id) {
        activeDesign = null;
        showDashboard();
      } else {
        renderDashboard();
      }
    } catch (e) {
      alert(`Could not delete design: ${e.message}`);
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

    // Character picker
    applyCharSelection(activeDesign.character_id || null);

    // Art style visual grid selection
    applyStyleSelection(activeDesign.art_style_id || null);

    // Reset ephemeral state
    sketchUrls   = [];
    conceptUrls  = [];
    sketchVotes  = [{}, {}, {}];
    conceptVotes = [{}, {}, {}];
    iteratingSketchCardId      = null;
    iteratingCoverSketchCardId = null;

    // Product format
    const productFormatEl = qs('#cd-product-format');
    if (productFormatEl) productFormatEl.value = activeDesign.product_format || '';

    // Blank card checkbox
    const blankCheck = qs('#cd-blank-card-check');
    if (blankCheck) blankCheck.checked = !!activeDesign.is_blank_card;

    updateSidebarMeta();
    renderCopyRounds();
    renderSketchRounds();
    renderCoverSketchRounds();
    renderConceptRounds();
    clearRightCard();

    // Re-populate copy editor if confirmed copy exists
    const confirmedCopy = activeDesign?.selected_copy;
    const editorPanel = qs('#cd-copy-editor-panel');
    if (editorPanel && confirmedCopy && (confirmedCopy.cover || confirmedCopy.inside_left)) {
      const setField = (id, val) => { const el = qs(id); if (el) el.value = val || ''; };
      setField('#cd-copy-edit-cover',        confirmedCopy.cover);
      setField('#cd-copy-edit-inside-left',  confirmedCopy.inside_left);
      setField('#cd-copy-edit-inside-right', confirmedCopy.inside_right);
      setField('#cd-copy-edit-sculpture',    confirmedCopy.sculpture);
      setField('#cd-copy-edit-back',         confirmedCopy.back);
      // Only show if on copy module (switchModule below will handle toggling)
    }

    // Restore last active module for this card (defaults to 'copy')
    const activeModule = lsGet(activeDesign.id, 'active_module', 'copy');
    switchModule(activeModule);
    // Explicitly enforce blank-card visibility (belt-and-suspenders after async re-renders)
    qs('#cd-brief-blank-card')?.classList.toggle('hidden', activeModule !== 'copy');
    updateRegenBtn(activeModule);

    // Load cover styles for picker
    loadCoverStylesForPicker();
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
    for (const mod of ['copy', 'sketch', 'cover-sketch', 'concept', 'finalize']) {
      qs(`#cd-module-${mod}`)?.classList.toggle('hidden', mod !== name);
      qs(`#cd-module-${mod}`)?.classList.toggle('active', mod === name);
    }

    const isInsideSketch = name === 'sketch';
    const isCoverSketch  = name === 'cover-sketch';
    const isConcept      = name === 'concept';
    const isFinalize     = name === 'finalize';

    // Sidebar section visibility
    qs('#cd-brief-fidelity')?.classList.toggle('hidden', !isInsideSketch && !isCoverSketch);
    qs('#cd-brief-art-style')?.classList.toggle('hidden', !isConcept);
    qs('#cd-brief-selected-copy')?.classList.toggle('hidden', !isInsideSketch && !isCoverSketch && !isConcept);
    qs('#cd-brief-selected-sketch')?.classList.toggle('hidden', !isConcept && !isCoverSketch);
    qs('#cd-brief-selected-cover-sketch')?.classList.toggle('hidden', !isConcept);
    qs('#cd-brief-cover-ref')?.classList.toggle('hidden', !isCoverSketch);
    qs('#cd-brief-sculpture-ref')?.classList.toggle('hidden', !isInsideSketch);
    qs('#cd-refine-bar')?.classList.toggle('hidden', !isInsideSketch);
    qs('#cd-cover-sketch-refine-bar')?.classList.toggle('hidden', !isCoverSketch);
    qs('#cd-concept-refine-bar')?.classList.toggle('hidden', !isConcept);
    qs('#cd-finalize-bar')?.classList.toggle('hidden', !isFinalize);
    qs('#cd-brief-blank-card')?.classList.toggle('hidden', name !== 'copy');

    // Show copy editor panel only on copy tab
    const editorPanel = qs('#cd-copy-editor-panel');
    if (editorPanel) {
      if (name !== 'copy') {
        editorPanel.classList.add('hidden');
      } else {
        // Re-show if confirmed copy exists and user switches back
        const copy = activeDesign?.selected_copy;
        if (copy && (copy.cover || copy.inside_left)) {
          const setField = (id, val) => { const el = qs(id); if (el) el.value = val || ''; };
          setField('#cd-copy-edit-cover',        copy.cover);
          setField('#cd-copy-edit-inside-left',  copy.inside_left);
          setField('#cd-copy-edit-inside-right', copy.inside_right);
          setField('#cd-copy-edit-sculpture',    copy.sculpture);
          setField('#cd-copy-edit-back',         copy.back);
          editorPanel.classList.remove('hidden');
        }
      }
    }

    if (isInsideSketch) {
      updateRefineBar();
      renderSelectedCopyBrief();
      renderSculptureRef();
    }
    qs('#cd-brief-cover-style')?.classList.toggle('hidden', !isCoverSketch);

    if (isCoverSketch) {
      updateCoverSketchRefineBar();
      renderSelectedCopyBrief();
      renderCoverRef();
    }
    if (isConcept) {
      renderSelectedCopyBrief();
      renderSelectedSketchBrief();
      renderSelectedCoverSketchBrief();
      updateConceptGenerateBtn();
    }

    // Update regen button label + hint based on active module and existing rounds
    updateRegenBtn(name);
    updateNextStepBtn(name);
    if (isFinalize) renderFinalizePanel();
  }

  function updateRegenBtn(moduleName) {
    const mod = moduleName || lsGet(activeDesign?.id, 'active_module', 'copy');
    const regenBtn  = qs('#cd-regen-btn');
    const regenHint = qs('#cd-regen-hint');
    if (!regenBtn) return;

    if (mod === 'copy') {
      if (activeDesign?.is_blank_card) {
        regenBtn.textContent = 'Blank card selected';
        regenBtn.classList.add('cd-regen-btn--disabled');
        if (regenHint) regenHint.textContent = 'Uncheck "Blank card" to generate copy options.';
      } else {
        regenBtn.classList.remove('cd-regen-btn--disabled');
        const hasRounds = (activeDesign?.copy_rounds?.length || 0) > 0;
        regenBtn.textContent = hasRounds ? '✨ Regenerate copy' : '✨ Generate copy';
        if (regenHint) regenHint.textContent = hasRounds
          ? 'Generate a new round of copy options.'
          : 'Generate the first round of copy options.';
      }
    } else if (mod === 'sketch') {
      const hasRounds = (activeDesign?.sketch_rounds?.length || 0) > 0;
      regenBtn.textContent = hasRounds ? '✨ Regenerate sketches' : '✨ Generate sketches';
      if (regenHint) regenHint.textContent = hasRounds
        ? 'Generate a new round of inside sketches.'
        : 'Generate the first round of inside sketches.';
    } else if (mod === 'cover-sketch') {
      const hasRounds = (activeDesign?.cover_sketch_rounds?.length || 0) > 0;
      regenBtn.textContent = hasRounds ? '✨ Regenerate cover sketches' : '✨ Generate cover sketches';
      if (regenHint) regenHint.textContent = hasRounds
        ? 'Generate a new round of cover sketches.'
        : 'Generate the first round of cover sketches.';
    } else {
      const hasRounds = (activeDesign?.concept_rounds?.length || 0) > 0;
      regenBtn.textContent = hasRounds ? '✨ Regenerate concepts' : '✨ Generate concepts';
      if (regenHint) regenHint.textContent = hasRounds
        ? 'Generate a new round of detailed concepts.'
        : 'Generate the first detailed concepts.';
    }
  }

  function nextStep() {
    if (!activeDesign) return;
    const current = lsGet(activeDesign.id, 'active_module', 'copy');
    const order = ['copy', 'sketch', 'cover-sketch', 'concept', 'finalize'];
    const idx = order.indexOf(current);
    if (idx >= 0 && idx < order.length - 1) switchModule(order[idx + 1]);
  }

  function updateNextStepBtn(moduleName) {
    const btn = qs('#cd-next-step-btn');
    if (!btn) return;
    const labels = {
      copy: 'Next: Inside Sketch →',
      sketch: 'Next: Cover Sketch →',
      'cover-sketch': 'Next: Detailed Concepts →',
      concept: 'Next: Finalize →',
      finalize: '✓ Design Complete',
    };
    btn.textContent = labels[moduleName] || 'Next Step →';
    const isReady =
      (moduleName === 'copy'         && !!(activeDesign?.is_blank_card || activeDesign?.selected_copy?.cover || activeDesign?.selected_copy?.inside_left)) ||
      (moduleName === 'sketch'       && !!activeDesign?.selected_sketch_url) ||
      (moduleName === 'cover-sketch' && !!activeDesign?.selected_cover_sketch_url) ||
      (moduleName === 'concept'      && !!activeDesign?.selected_concept_url) ||
      (moduleName === 'finalize');
    btn.classList.toggle('cd-next-step-btn--ready', !!isReady);
    btn.disabled = moduleName === 'finalize';
  }

  function renderSelectedCopyBrief() {
    const el = qs('#cd-brief-selected-copy-content');
    if (!el) return;
    if (activeDesign?.is_blank_card) {
      el.innerHTML = '<span class="cd-brief-blank-card-msg">Blank card — no sentiment copy</span>';
      qs('#cd-brief-selected-copy')?.classList.remove('hidden');
      return;
    }
    const copy = activeDesign?.selected_copy;
    if (!copy || (!copy.cover && !copy.inside_left && !copy.inside_right && !copy.sculpture)) {
      el.innerHTML = '<em class="cd-brief-no-selection">No copy selected yet — go to Copy tab first.</em>';
      return;
    }
    const fields = [
      ['Cover', copy.cover],
      ['Inside Left', copy.inside_left],
      ['Inside Right', copy.inside_right],
      ['Sculpture', copy.sculpture],
    ].filter(([, v]) => v);
    el.innerHTML = fields.map(([lbl, val]) => `
      <div class="cd-brief-copy-field">
        <div class="cd-brief-copy-field-lbl">${lbl}</div>
        <div class="cd-brief-copy-field-val">${escHtml(val)}</div>
      </div>
    `).join('');
  }

  function renderSelectedSketchBrief() {
    const el = qs('#cd-brief-selected-sketch-content');
    if (!el) return;
    const url = activeDesign?.selected_sketch_url;
    if (!url) {
      el.innerHTML = '<em class="cd-brief-no-selection">No inside sketch selected yet — go to Inside Sketch tab first.</em>';
      return;
    }
    el.innerHTML = `
      <div style="position:relative">
        <img src="${escAttr(url)}" class="cd-brief-sketch-thumb zoomable" alt="Selected inside sketch" title="Click to enlarge"
          onerror="this.parentElement.innerHTML='<em class=\\'cd-brief-no-selection\\'>Selected sketch file missing.</em><button class=\\'cd-brief-clear-btn\\' onclick=\\'clearSelectedSketch()\\'>Clear</button>'" />
        <button class="cd-brief-clear-btn" onclick="clearSelectedSketch()" title="Clear selected sketch">× Clear</button>
      </div>`;
  }

  function renderSelectedCoverSketchBrief() {
    const el = qs('#cd-brief-selected-cover-sketch-content');
    if (!el) return;
    const url = activeDesign?.selected_cover_sketch_url;
    if (!url) {
      el.innerHTML = '<em class="cd-brief-no-selection">No cover sketch selected yet.</em>';
      return;
    }
    el.innerHTML = `
      <div style="position:relative">
        <img src="${escAttr(url)}" class="cd-brief-sketch-thumb zoomable" alt="Selected cover sketch" title="Click to enlarge"
          onerror="this.parentElement.innerHTML='<em class=\\'cd-brief-no-selection\\'>Selected sketch file missing.</em><button class=\\'cd-brief-clear-btn\\' onclick=\\'clearSelectedCoverSketch()\\'>Clear</button>'" />
        <button class="cd-brief-clear-btn" onclick="clearSelectedCoverSketch()" title="Clear selected cover sketch">× Clear</button>
      </div>`;
  }

  async function clearSelectedSketch() {
    if (!activeDesign) return;
    try {
      const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected_sketch_url: '' }),
      });
      activeDesign = await resp.json();
      designs = designs.map(d => d.id === activeDesign.id ? activeDesign : d);
      renderSelectedSketchBrief();
      renderSketchRounds();
      updateNextStepBtn('sketch');
    } catch (e) { console.warn('clearSelectedSketch error:', e.message); }
  }

  async function clearSelectedCoverSketch() {
    if (!activeDesign) return;
    try {
      const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected_cover_sketch_url: '' }),
      });
      activeDesign = await resp.json();
      designs = designs.map(d => d.id === activeDesign.id ? activeDesign : d);
      renderSelectedCoverSketchBrief();
      renderCoverSketchRounds();
      updateNextStepBtn('cover-sketch');
    } catch (e) { console.warn('clearSelectedCoverSketch error:', e.message); }
  }

  function renderFinalizePanel() {
    const wrap = qs('#cd-finalize-concept-img-wrap');
    if (!wrap || !activeDesign) return;
    const url = activeDesign.selected_concept_url;
    if (url) {
      wrap.innerHTML = `<img src="${escAttr(url)}" class="cd-finalize-concept-img zoomable" alt="Selected concept" title="Click to enlarge" />`;
    } else {
      wrap.innerHTML = `<div class="cd-finalize-no-concept">No concept selected yet — select a concept in the Detailed Concepts tab first.</div>`;
    }
    // Restore saved notes/comments
    const notesEl = qs('#cd-finalize-notes');
    if (notesEl && !notesEl.value) notesEl.value = activeDesign.finalize_notes || '';
    const commentsEl = qs('#cd-finalize-comments');
    if (commentsEl && !commentsEl.value) commentsEl.value = activeDesign.finalize_comments || '';
  }

  function updateConceptGenerateBtn() {
    const allRounds = activeDesign?.concept_rounds || [];
    const btn = qs('#cd-concept-generate-btn');
    if (btn) btn.textContent = `Generate Round ${allRounds.length + 1} →`;
  }

  // ── Sculpture reference image ──────────────────────────────────
  function renderSculptureRef() {
    const emptyEl   = qs('#cd-sculpture-ref-empty');
    const previewEl = qs('#cd-sculpture-ref-preview');
    const imgEl     = qs('#cd-sculpture-ref-img');
    if (!emptyEl || !previewEl || !imgEl) return;
    const url = activeDesign?.sketch_ref_image;
    if (url) {
      emptyEl.classList.add('hidden');
      previewEl.classList.remove('hidden');
      imgEl.src = url;
    } else {
      emptyEl.classList.remove('hidden');
      previewEl.classList.add('hidden');
      imgEl.src = '';
    }
  }

  function initSculptureRefZone() {
    const zone     = qs('#cd-sculpture-ref-zone');
    const input    = qs('#cd-sculpture-ref-input');
    const clearBtn = qs('#cd-sculpture-ref-clear');
    if (!zone || !input) return;

    // Click zone → open file picker
    zone.addEventListener('click', e => {
      if (e.target === clearBtn || clearBtn?.contains(e.target)) return;
      if (e.target.closest('.cd-ref-zone-preview')) return; // let lightbox handle img clicks
      input.click();
    });

    // File picker change
    input.addEventListener('change', () => {
      if (input.files?.[0]) uploadSculptureRef(input.files[0]);
      input.value = '';
    });

    // Drag & drop
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over'); });
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) uploadSculptureRef(file);
    });

    // Hover → capture paste events from clipboard
    let pasteHandler = null;
    zone.addEventListener('mouseenter', () => {
      pasteHandler = e => {
        const item = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'));
        if (item) { e.preventDefault(); uploadSculptureRef(item.getAsFile()); }
      };
      document.addEventListener('paste', pasteHandler);
      zone.classList.add('paste-ready');
    });
    zone.addEventListener('mouseleave', () => {
      if (pasteHandler) { document.removeEventListener('paste', pasteHandler); pasteHandler = null; }
      zone.classList.remove('paste-ready');
    });

    // Clear button
    clearBtn?.addEventListener('click', e => { e.stopPropagation(); clearSculptureRef(); });
  }

  async function uploadSculptureRef(file) {
    if (!activeDesign) return;
    // Show immediate preview from local file
    const localUrl = URL.createObjectURL(file);
    const emptyEl   = qs('#cd-sculpture-ref-empty');
    const previewEl = qs('#cd-sculpture-ref-preview');
    const imgEl     = qs('#cd-sculpture-ref-img');
    const zone      = qs('#cd-sculpture-ref-zone');
    if (emptyEl)   emptyEl.classList.add('hidden');
    if (previewEl) previewEl.classList.remove('hidden');
    if (imgEl)     imgEl.src = localUrl;
    if (zone)      zone.classList.add('uploading');

    try {
      const formData = new FormData();
      formData.append('image', file);
      const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}/sketch-ref`, {
        method: 'POST',
        body: formData,
      });
      if (!resp.ok) throw new Error((await resp.json()).error || 'Upload failed');
      const data = await resp.json();
      activeDesign = data.design;
      designs = designs.map(d => d.id === activeDesign.id ? activeDesign : d);
      // Replace local blob URL with server URL
      if (imgEl) imgEl.src = data.path;
      URL.revokeObjectURL(localUrl);
    } catch (e) {
      alert(`Failed to upload reference image: ${e.message}`);
      renderSculptureRef(); // revert to saved state
    } finally {
      if (zone) zone.classList.remove('uploading');
    }
  }

  async function clearSculptureRef() {
    if (!activeDesign) return;
    try {
      const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}/sketch-ref`, { method: 'DELETE' });
      if (!resp.ok) throw new Error('Failed to clear reference');
      const data = await resp.json();
      activeDesign = data.design;
      designs = designs.map(d => d.id === activeDesign.id ? activeDesign : d);
      renderSculptureRef();
    } catch (e) {
      alert(`Failed to remove reference image: ${e.message}`);
    }
  }

  // ── Cover reference image ──────────────────────────────────────
  function renderCoverRef() {
    const emptyEl   = qs('#cd-cover-ref-empty');
    const previewEl = qs('#cd-cover-ref-preview');
    const imgEl     = qs('#cd-cover-ref-img');
    if (!emptyEl || !previewEl || !imgEl) return;
    const url = activeDesign?.cover_ref_image;
    if (url) {
      emptyEl.classList.add('hidden');
      previewEl.classList.remove('hidden');
      imgEl.src = url;
    } else {
      emptyEl.classList.remove('hidden');
      previewEl.classList.add('hidden');
      imgEl.src = '';
    }
  }

  function initCoverRefZone() {
    const zone     = qs('#cd-cover-ref-zone');
    const input    = qs('#cd-cover-ref-input');
    const clearBtn = qs('#cd-cover-ref-clear');
    if (!zone || !input) return;

    zone.addEventListener('click', e => {
      if (e.target === clearBtn || clearBtn?.contains(e.target)) return;
      if (e.target.closest('.cd-ref-zone-preview')) return;
      input.click();
    });
    input.addEventListener('change', () => {
      if (input.files?.[0]) uploadCoverRef(input.files[0]);
      input.value = '';
    });
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', e => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over'); });
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) uploadCoverRef(file);
    });
    let pasteHandler = null;
    zone.addEventListener('mouseenter', () => {
      pasteHandler = e => {
        const item = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'));
        if (item) { e.preventDefault(); uploadCoverRef(item.getAsFile()); }
      };
      document.addEventListener('paste', pasteHandler);
      zone.classList.add('paste-ready');
    });
    zone.addEventListener('mouseleave', () => {
      if (pasteHandler) { document.removeEventListener('paste', pasteHandler); pasteHandler = null; }
      zone.classList.remove('paste-ready');
    });
    clearBtn?.addEventListener('click', e => { e.stopPropagation(); clearCoverRef(); });
  }

  async function uploadCoverRef(file) {
    if (!activeDesign) return;
    const localUrl = URL.createObjectURL(file);
    const emptyEl   = qs('#cd-cover-ref-empty');
    const previewEl = qs('#cd-cover-ref-preview');
    const imgEl     = qs('#cd-cover-ref-img');
    const zone      = qs('#cd-cover-ref-zone');
    if (emptyEl)   emptyEl.classList.add('hidden');
    if (previewEl) previewEl.classList.remove('hidden');
    if (imgEl)     imgEl.src = localUrl;
    if (zone)      zone.classList.add('uploading');
    try {
      const formData = new FormData();
      formData.append('image', file);
      const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}/cover-ref`, {
        method: 'POST',
        body: formData,
      });
      if (!resp.ok) throw new Error((await resp.json()).error || 'Upload failed');
      const data = await resp.json();
      activeDesign = data.design;
      designs = designs.map(d => d.id === activeDesign.id ? activeDesign : d);
      if (imgEl) imgEl.src = data.path;
      URL.revokeObjectURL(localUrl);
    } catch (e) {
      alert(`Failed to upload cover reference: ${e.message}`);
      renderCoverRef();
    } finally {
      if (zone) zone.classList.remove('uploading');
    }
  }

  async function clearCoverRef() {
    if (!activeDesign) return;
    try {
      const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}/cover-ref`, { method: 'DELETE' });
      if (!resp.ok) throw new Error('Failed to clear cover reference');
      const data = await resp.json();
      activeDesign = data.design;
      designs = designs.map(d => d.id === activeDesign.id ? activeDesign : d);
      renderCoverRef();
    } catch (e) {
      alert(`Failed to remove cover reference: ${e.message}`);
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

  async function saveProductFormat() {
    if (!activeDesign) return;
    const product_format = qs('#cd-product-format')?.value || '';
    try {
      const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product_format }),
      });
      activeDesign = await resp.json();
      designs = designs.map(d => d.id === activeDesign.id ? activeDesign : d);
    } catch (e) {
      console.warn('[card-designer] saveProductFormat error:', e.message);
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
    if (activeModule === 'cover-sketch') { generateCoverSketchRound(); return; }
    if (activeModule === 'concept') { generateConcept(); return; }

    const btn = qs('#cd-regen-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Generating…'; }

    const count        = parseInt(qs('.cd-gen-n.active')?.dataset.count || '3', 10);
    const direction    = qs('#cd-creative-direction')?.value || '';
    const character_id = selectedCharId                      || '';
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
      updateRegenBtn('copy');
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
    const direction_notes = [];
    // Use notes from all cards (regardless of selection) as direction
    for (const r of rounds) {
      for (const card of (r.cards || [])) {
        if (card.note && card.note.trim()) direction_notes.push(card.note.trim());
      }
    }
    // The currently selected copy is the liked example to build upon
    const selectedId = activeDesign?.selected_copy_id;
    if (selectedId) {
      for (const r of rounds) {
        const found = (r.cards || []).find(c => c.id === selectedId);
        if (found) { liked_examples.push(found); break; }
      }
    }
    if (!liked_examples.length && !direction_notes.length) return null;
    return { liked_examples, direction_notes };
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
    const rounds  = Array.isArray(activeDesign.copy_rounds) ? activeDesign.copy_rounds : [];
    const emptyEl = qs('#cd-copy-empty');
    const listEl  = qs('#cd-copy-rounds');
    if (!listEl) return;

    // Blank card state
    if (activeDesign?.is_blank_card) {
      if (emptyEl) {
        emptyEl.classList.remove('hidden');
        const iconEl = emptyEl.querySelector('.cd-rounds-empty-icon');
        const titleEl = emptyEl.querySelector('.cd-rounds-empty-title');
        const subEl = emptyEl.querySelector('.cd-rounds-empty-sub');
        if (iconEl) iconEl.textContent = '○';
        if (titleEl) titleEl.textContent = 'Blank card';
        if (subEl) subEl.textContent = 'This card has no sentiment copy. Uncheck "Blank card" in the sidebar to generate copy options.';
      }
      listEl.innerHTML = '';
      qs('#cd-copy-editor-panel')?.classList.add('hidden');
      return;
    }

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

      // Note input — debounced save
      cardEl.querySelector('.cd-copy-note-input')?.addEventListener('input', e => {
        patchCopyCard(roundId, cardId, { note: e.target.value });
      });

      // "Use this →" button — load into editor
      cardEl.querySelector('.cd-copy-pick-btn')?.addEventListener('click', () => {
        // Find the card object from rounds
        let selectedCard = null;
        for (const r of (activeDesign?.copy_rounds || [])) {
          selectedCard = (r.cards || []).find(c => c.id === cardId);
          if (selectedCard) break;
        }
        if (selectedCard) loadCopyIntoEditor(selectedCard);
      });
    });
  }

  function copyCardHtml(card, cardIdx, roundId) {
    const isSelected = activeDesign?.selected_copy_id === card.id;
    const isEditing  = activeDesign?._editing_copy_source_id === card.id;
    const cardClass  = `cd-copy-card${isSelected ? ' selected' : ''}${isEditing ? ' editing' : ''}`;
    const btnLabel   = isSelected ? '✓ Confirmed' : isEditing ? '↑ In editor' : 'Use this →';
    const btnPicked  = (isSelected || isEditing) ? ' picked' : '';
    return `
      <div class="${cardClass}" data-card-id="${escAttr(card.id)}" data-round-id="${escAttr(roundId)}">
        <div class="cd-copy-card-hdr">
          <span class="cd-copy-opt-label">OPTION ${cardIdx + 1}</span>
          ${isSelected ? '<span class="cd-copy-selected-badge">✓ CONFIRMED</span>' : ''}
        </div>
        <div class="cd-copy-card-body">
          ${card.cover       ? `<div><div class="cd-copy-field-lbl">Cover</div><div class="cd-copy-field-cover">${escHtml(card.cover)}</div></div>` : ''}
          ${card.inside_left ? `<div><div class="cd-copy-field-lbl">Inside Left</div><div class="cd-copy-field-il">${escHtml(card.inside_left)}</div></div>` : ''}
          ${card.inside_right? `<div><div class="cd-copy-field-lbl">Inside Right</div><div class="cd-copy-field-ir">${escHtml(card.inside_right)}</div></div>` : ''}
          ${card.sculpture   ? `<div><div class="cd-copy-field-lbl">Sculpture</div><div class="cd-copy-field-sc">${escHtml(card.sculpture)}</div></div>` : ''}
        </div>
        <div class="cd-copy-card-footer">
          <input type="text" class="cd-copy-note-input${card.note ? ' has-note' : ''}" placeholder="Add a comment or direction…" value="${escAttr(card.note || '')}" />
          <button class="cd-copy-pick-btn${btnPicked}">
            ${btnLabel}
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
      // Move to Sketches tab now that a copy has been selected as final
      switchModule('sketch');
    } catch (e) {
      console.error('[copy] selectCopyFromRound error:', e.message);
    }
  }

  function loadCopyIntoEditor(card) {
    const panel = qs('#cd-copy-editor-panel');
    if (!panel) return;

    // Populate fields
    const setField = (id, val) => { const el = qs(id); if (el) el.value = val || ''; };
    setField('#cd-copy-edit-cover',        card.cover);
    setField('#cd-copy-edit-inside-left',  card.inside_left);
    setField('#cd-copy-edit-inside-right', card.inside_right);
    setField('#cd-copy-edit-sculpture',    card.sculpture);
    setField('#cd-copy-edit-back',         card.back);

    // Track which card was loaded
    panel.dataset.sourceCardId = card.id;

    // Show the panel
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    // Mark editing source on activeDesign (transient, not persisted)
    activeDesign._editing_copy_source_id = card.id;
    renderCopyRounds();
  }

  async function confirmCopy() {
    if (!activeDesign) return;
    const getField = (id) => (qs(id)?.value || '').trim();
    const copy = {
      cover:        getField('#cd-copy-edit-cover'),
      inside_left:  getField('#cd-copy-edit-inside-left'),
      inside_right: getField('#cd-copy-edit-inside-right'),
      sculpture:    getField('#cd-copy-edit-sculpture'),
      back:         getField('#cd-copy-edit-back'),
    };
    const panel = qs('#cd-copy-editor-panel');
    const sourceCardId = panel?.dataset.sourceCardId || null;

    try {
      const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected_copy: copy, selected_copy_id: sourceCardId }),
      });
      activeDesign = await resp.json();
      designs = designs.map(d => d.id === activeDesign.id ? activeDesign : d);
      delete activeDesign._editing_copy_source_id;
      renderCopyRounds();
      renderSelectedCopyBrief();
      updateSidebarMeta();
      // Hide editor and move to Inside Sketch
      if (panel) panel.classList.add('hidden');
      switchModule('sketch');
    } catch (e) {
      alert('Could not save copy: ' + e.message);
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
    const rounds  = Array.isArray(activeDesign.sketch_rounds) ? activeDesign.sketch_rounds : [];
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
            ${cards.map((card, ci) => sketchCardHtml(card, ri, ci)).join('')}
          </div>
        </div>
      `;
    }).join('');

    // Bind card interactions
    listEl.querySelectorAll('.cd-sk-card').forEach(cardEl => {
      const cardId  = cardEl.dataset.cardId;

      // Iterate button
      cardEl.querySelector('.cd-sk-iterate-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        setIteratingSketchCard(cardId);
      });

      // Select button
      cardEl.querySelector('.cd-sk-select-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        selectSketchCard(cardId);
      });
    });
  }

  function sketchCardHtml(card, roundIdx, cardIdx) {
    const label = `${roundIdx + 1}${String.fromCharCode(65 + cardIdx)}`;
    const isSelected  = activeDesign?.selected_sketch_url === card.url;
    const isIterating = iteratingSketchCardId === card.id;
    const classes = ['cd-sk-card', isSelected ? 'selected' : '', isIterating ? 'iterating' : ''].filter(Boolean).join(' ');
    return `
      <div class="${classes}" data-card-id="${escAttr(card.id)}" data-label="${escAttr(label)}">
        <div class="cd-sk-card-label">${escHtml(label)}</div>
        <img src="${escAttr(card.url)}" class="cd-sk-card-img zoomable" loading="lazy" alt="Sketch ${label}" title="Click to enlarge" />
        <div class="cd-sk-card-footer">
          <button class="cd-sk-iterate-btn${isIterating ? ' active' : ''}">
            ${isIterating ? '↻ Iterating…' : '↻ Iterate'}
          </button>
          <button class="cd-sk-select-btn${isSelected ? ' selected' : ''}">
            ${isSelected ? '✓ Selected' : 'Select'}
          </button>
        </div>
      </div>
    `;
  }

  function setIteratingSketchCard(cardId) {
    // Toggle: clicking same card again clears iterating state
    if (iteratingSketchCardId === cardId) {
      iteratingSketchCardId = null;
    } else {
      iteratingSketchCardId = cardId;
    }
    renderSketchRounds();
    // Bold/activate the refine bar
    const refineBar = qs('#cd-refine-bar');
    if (refineBar) refineBar.classList.toggle('iterate-active', !!iteratingSketchCardId);
    if (iteratingSketchCardId) {
      const input = qs('#cd-refine-input');
      if (input) input.focus();
    }
  }

  function setIteratingCoverSketchCard(cardId) {
    if (iteratingCoverSketchCardId === cardId) {
      iteratingCoverSketchCardId = null;
    } else {
      iteratingCoverSketchCardId = cardId;
    }
    renderCoverSketchRounds();
    const refineBar = qs('#cd-cover-sketch-refine-bar');
    if (refineBar) refineBar.classList.toggle('iterate-active', !!iteratingCoverSketchCardId);
    if (iteratingCoverSketchCardId) {
      const input = qs('#cd-cover-sketch-refine-input');
      if (input) input.focus();
    }
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
    const chipsEl = qs('#cd-refine-chips');
    if (chipsEl) chipsEl.innerHTML = ''; // no more pin/dislike chips
    const nextRound = allRounds.length + 1;
    const btn = qs('#cd-sketch-generate-btn');
    if (btn) btn.textContent = `Generate Round ${nextRound} →`;
  }

  function updateCoverSketchRefineBar() {
    if (!activeDesign) return;
    const allRounds = activeDesign.cover_sketch_rounds || [];
    const nextRound = allRounds.length + 1;
    const btn = qs('#cd-cover-sketch-generate-btn');
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

    const parent_card_id = iteratingSketchCardId || null;

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
      iteratingSketchCardId = null; // clear iterating state after generating
    } catch (e) {
      alert(`Sketch generation failed: ${e.message}`);
      if (emptyEl && !(activeDesign.sketch_rounds || []).length) emptyEl.classList.remove('hidden');
    } finally {
      renderSketchRounds();
      updateRefineBar();
      const refineBar = qs('#cd-refine-bar');
      if (refineBar) refineBar.classList.remove('iterate-active');
      if (btn) btn.disabled = false;
    }
  }

  async function selectSketchCard(cardId) {
    if (!activeDesign) return;
    try {
      const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}/promote-sketch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_id: cardId }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Promote failed');
      activeDesign = data;
      designs = designs.map(d => d.id === activeDesign.id ? activeDesign : d);
      renderSketchRounds();
      renderSelectedSketch();
      updateSidebarMeta();
      updateNextStepBtn('sketch');
    } catch (e) {
      alert(`Could not select sketch: ${e.message}`);
    }
  }

  async function promoteSketch() {
    // Legacy: called by refine bar "Select as final" button when a card is focused
    if (!activeDesign || !focusedSketchCard) return;
    await selectSketchCard(focusedSketchCard.id);
    const btn = qs('#cd-sketch-final-btn');
    if (btn) { btn.textContent = '✓ Selected'; setTimeout(() => { btn.textContent = '✓ Select as final'; }, 1500); }
  }

  async function refineRightCard() {
    if (!focusedSketchCard) return;
    // Pin the focused card then trigger a new round
    await patchSketchCard(focusedSketchCard.id, { vote: 'pin' });
    const refineInput = qs('#cd-refine-input');
    if (refineInput) refineInput.focus();
  }

  // ── Cover Sketch ───────────────────────────────────────────────
  async function generateCoverSketchRound() {
    if (!activeDesign) return;
    const btn         = qs('#cd-cover-sketch-generate-btn');
    const refineInput = qs('#cd-cover-sketch-refine-input');
    const refine_note = refineInput?.value?.trim() || '';
    const fidelity    = lsGet(activeDesign.id, 'fidelity', 'standard');
    const allRounds   = activeDesign.cover_sketch_rounds || [];
    const roundNum    = allRounds.length + 1;

    if (btn) { btn.disabled = true; btn.textContent = `⏳ Generating Round ${roundNum}…`; }

    // Show skeleton placeholders
    const emptyEl = qs('#cd-cover-sketch-empty');
    const listEl  = qs('#cd-cover-sketch-rounds');
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
      const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}/cover-sketch/round`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refine_note, fidelity, count: 3, parent_card_id: iteratingCoverSketchCardId || null }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Generation failed');
      activeDesign = data.design;
      designs = designs.map(d => d.id === activeDesign.id ? activeDesign : d);
      if (refineInput) refineInput.value = '';
      iteratingCoverSketchCardId = null;
    } catch (e) {
      alert(`Cover sketch generation failed: ${e.message}`);
      if (emptyEl && !(activeDesign.cover_sketch_rounds || []).length) emptyEl.classList.remove('hidden');
    } finally {
      renderCoverSketchRounds();
      updateCoverSketchRefineBar();
      const refineBar = qs('#cd-cover-sketch-refine-bar');
      if (refineBar) refineBar.classList.remove('iterate-active');
      if (btn) btn.disabled = false;
    }
  }

  function renderCoverSketchRounds() {
    if (!activeDesign) return;
    const rounds  = Array.isArray(activeDesign.cover_sketch_rounds) ? activeDesign.cover_sketch_rounds : [];
    const emptyEl = qs('#cd-cover-sketch-empty');
    const listEl  = qs('#cd-cover-sketch-rounds');
    if (!emptyEl || !listEl) return;

    if (!rounds.length) {
      emptyEl.classList.remove('hidden');
      listEl.innerHTML = '';
      updateCoverSketchRefineBar();
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
            ${cards.map((card, ci) => coverSketchCardHtml(card, ri, ci)).join('')}
          </div>
        </div>
      `;
    }).join('');

    // Bind card interactions
    listEl.querySelectorAll('.cd-sk-card').forEach(cardEl => {
      const cardId = cardEl.dataset.cardId;

      cardEl.querySelector('.cd-sk-iterate-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        setIteratingCoverSketchCard(cardId);
      });

      cardEl.querySelector('.cd-sk-select-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        selectCoverSketchCard(cardId);
      });
    });

    updateCoverSketchRefineBar();
  }

  function coverSketchCardHtml(card, roundIdx, cardIdx) {
    const label = `${roundIdx + 1}${String.fromCharCode(65 + cardIdx)}`;
    const isSelected  = activeDesign?.selected_cover_sketch_url === card.url;
    const isIterating = iteratingCoverSketchCardId === card.id;
    const classes = ['cd-sk-card cd-cover-sk-card', isSelected ? 'selected' : '', isIterating ? 'iterating' : ''].filter(Boolean).join(' ');
    return `
      <div class="${classes}" data-card-id="${escAttr(card.id)}" data-label="${escAttr(label)}">
        <div class="cd-sk-card-label">${escHtml(label)}</div>
        <img src="${escAttr(card.url)}" class="cd-sk-card-img zoomable" loading="lazy" alt="Cover Sketch ${label}" title="Click to enlarge" />
        <div class="cd-sk-card-footer">
          <button class="cd-sk-iterate-btn${isIterating ? ' active' : ''}">
            ${isIterating ? '↻ Iterating…' : '↻ Iterate'}
          </button>
          <button class="cd-sk-select-btn${isSelected ? ' selected' : ''}">
            ${isSelected ? '✓ Selected' : 'Select'}
          </button>
        </div>
      </div>
    `;
  }

  async function patchCoverSketchCard(cardId, updates) {
    if (!activeDesign) return;
    try {
      const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}/cover-sketch/card/${cardId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Update failed');
      activeDesign = data;
      designs = designs.map(d => d.id === activeDesign.id ? activeDesign : d);
      renderCoverSketchRounds();
    } catch (e) {
      console.error('[cover-sketch] patchCoverSketchCard error:', e.message);
    }
  }

  async function selectCoverSketchCard(cardId) {
    if (!activeDesign) return;
    try {
      const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}/promote-cover-sketch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_id: cardId }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Promote failed');
      activeDesign = data;
      designs = designs.map(d => d.id === activeDesign.id ? activeDesign : d);
      renderCoverSketchRounds();
      renderSelectedCoverSketchBrief();
      updateSidebarMeta();
      updateNextStepBtn('cover-sketch');
    } catch (e) {
      alert(`Could not select cover sketch: ${e.message}`);
    }
  }

  async function saveFinalizeNotes() {
    if (!activeDesign) return;
    const notes    = qs('#cd-finalize-notes')?.value    || '';
    const comments = qs('#cd-finalize-comments')?.value || '';
    try {
      const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ finalize_notes: notes, finalize_comments: comments }),
      });
      if (resp.ok) activeDesign = await resp.json();
    } catch (e) { console.warn('[finalize] save notes error:', e.message); }
  }

  function exportDesignSpec() {
    if (!activeDesign) return;
    const d = activeDesign;
    const copy = d.selected_copy || {};
    const lines = [
      `LOVEPOP CARD DESIGN SPECIFICATION`,
      `Generated: ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
      ``,
      `DESIGN: ${d.name || 'Untitled Design'}`,
      `PRODUCT TITLE: ${d.product_title || '—'}`,
      `PRODUCT FORMAT: ${d.product_format || '—'}`,
      `STATUS: ${d.status || '—'}`,
      ``,
      `COPY`,
      `Cover: ${copy.cover || '—'}`,
      `Inside Left: ${copy.inside_left || '—'}`,
      `Inside Right: ${copy.inside_right || '—'}`,
      `Sculpture: ${copy.sculpture || '—'}`,
      `Back: ${copy.back || '—'}`,
      ``,
      `CREATIVE DIRECTION`,
      d.notes || '—',
      ``,
      `DESIGN NOTES`,
      qs('#cd-finalize-notes')?.value || d.finalize_notes || '—',
      ``,
      `COMMENTS`,
      qs('#cd-finalize-comments')?.value || d.finalize_comments || '—',
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `${(d.name || 'design').replace(/[^a-z0-9]/gi, '-').toLowerCase()}-spec.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Detailed Concept ───────────────────────────────────────────
  async function generateConcept() {
    if (!activeDesign) return;
    const btn = qs('#cd-concept-generate-btn');
    const refineInput = qs('#cd-concept-refine-input');
    const refine_note = refineInput?.value?.trim() || '';
    const allRounds = activeDesign.concept_rounds || [];
    const roundNum = allRounds.length + 1;
    const count = parseInt(qs('.cd-gen-n.active')?.dataset.count || '3', 10);

    if (btn) { btn.disabled = true; btn.textContent = `⏳ Generating Round ${roundNum}…`; }

    // Show skeleton
    const emptyEl = qs('#cd-concept-empty');
    const listEl = qs('#cd-concept-rounds');
    if (emptyEl) emptyEl.classList.add('hidden');
    if (listEl) {
      const skeleton = document.createElement('div');
      skeleton.className = 'cd-round cd-round-skeleton';
      skeleton.innerHTML = `
        <div class="cd-round-header"><span class="cd-round-label">Round ${roundNum}</span></div>
        <div class="cd-round-grid">
          ${Array.from({ length: count }, () => '<div class="cd-sk-card cd-sk-card-skeleton"><div class="cd-sk-card-img-placeholder"></div></div>').join('')}
        </div>`;
      listEl.appendChild(skeleton);
      skeleton.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    try {
      const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}/generate-concept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          character_id: selectedCharId || '',
          art_style_id: selectedStyleId || '',
          refine_note,
          count,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Generation failed');
      activeDesign = data.design;
      designs = designs.map(d => d.id === activeDesign.id ? activeDesign : d);
      if (refineInput) refineInput.value = '';
    } catch (e) {
      alert(`Concept generation failed: ${e.message}`);
      if (emptyEl && !(activeDesign.concept_rounds || []).length) emptyEl.classList.remove('hidden');
    } finally {
      renderConceptRounds();
      updateConceptGenerateBtn();
      updateRegenBtn('concept');
      if (btn) btn.disabled = false;
    }
  }

  function renderConceptRounds() {
    if (!activeDesign) return;
    const rounds = Array.isArray(activeDesign.concept_rounds) ? activeDesign.concept_rounds : [];
    const emptyEl = qs('#cd-concept-empty');
    const listEl = qs('#cd-concept-rounds');
    if (!listEl) return;

    if (!rounds.length) {
      if (emptyEl) emptyEl.classList.remove('hidden');
      listEl.innerHTML = '';
      return;
    }
    if (emptyEl) emptyEl.classList.add('hidden');

    listEl.innerHTML = rounds.map((round, ri) => {
      const cards = round.cards || [];
      return `
        <div class="cd-round" data-round-id="${escAttr(round.id)}">
          <div class="cd-round-header">
            <span class="cd-round-label">Round ${ri + 1}</span>
            ${round.refine_note ? `<span class="cd-round-note">${escHtml(round.refine_note)}</span>` : ''}
          </div>
          <div class="cd-round-grid">
            ${cards.map((card, ci) => conceptCardHtml(card, ri, ci)).join('')}
          </div>
        </div>
      `;
    }).join('');

    // Bind events
    listEl.querySelectorAll('.cd-concept-card').forEach(cardEl => {
      const cardId = cardEl.dataset.cardId;
      cardEl.querySelector('.cd-sk-select-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        selectConceptCard(cardId);
      });
    });
  }

  function conceptCardHtml(card, roundIdx, cardIdx) {
    const label = `${roundIdx + 1}${String.fromCharCode(65 + cardIdx)}`;
    const isSelected  = activeDesign?.selected_concept_url === card.url;
    const classes = ['cd-sk-card cd-concept-card', isSelected ? 'selected' : ''].join(' ').trim();
    return `
      <div class="${classes}" data-card-id="${escAttr(card.id)}" data-label="${escAttr(label)}">
        <div class="cd-sk-card-label">${escHtml(label)}</div>
        <img src="${escAttr(card.url)}" class="cd-sk-card-img zoomable" loading="lazy" alt="Concept ${label}" title="Click to enlarge" />
        <div class="cd-sk-card-footer">
          <button class="cd-sk-select-btn${isSelected ? ' selected' : ''}">
            ${isSelected ? '✓ Selected' : 'Select'}
          </button>
        </div>
      </div>
    `;
  }

  async function patchConceptCard(cardId, updates) {
    if (!activeDesign) return;
    const allRounds = activeDesign.concept_rounds || [];
    for (const r of allRounds) {
      const card = (r.cards || []).find(c => c.id === cardId);
      if (card) { Object.assign(card, updates); break; }
    }
    try {
      await fetch(`/api/card-designer/designs/${activeDesign.id}/concept/card/${cardId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
    } catch (e) { console.warn('[concept] patchConceptCard error:', e.message); }
  }

  async function selectConceptCard(cardId) {
    if (!activeDesign) return;
    let selectedUrl = null;
    for (const r of (activeDesign.concept_rounds || [])) {
      const card = (r.cards || []).find(c => c.id === cardId);
      if (card) { selectedUrl = card.url; break; }
    }
    if (!selectedUrl) return;
    try {
      const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected_concept_url: selectedUrl }),
      });
      activeDesign = await resp.json();
      designs = designs.map(d => d.id === activeDesign.id ? activeDesign : d);
      renderConceptRounds();
      updateSidebarMeta();
      updateNextStepBtn('concept');
    } catch (e) {
      alert(`Could not select concept: ${e.message}`);
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

      // Character — populate modal grid
      const charGrid = qs('#cd-char-modal-grid');
      if (charGrid && Array.isArray(characters)) {
        characters.forEach(c => {
          const tile = document.createElement('button');
          tile.type = 'button';
          tile.className = 'cd-style-modal-tile';
          tile.dataset.charId = c.id;
          const img = (c.images || [])[0] || null;
          tile.innerHTML = `
            <div class="cd-style-modal-tile-img-wrap">
              ${img
                ? `<img src="${escAttr(img)}" class="cd-style-modal-tile-img" alt="${escHtml(c.name || '')}" loading="lazy" />`
                : `<div class="cd-style-modal-tile-placeholder">${escHtml((c.name || '?').charAt(0).toUpperCase())}</div>`}
            </div>
            <div class="cd-style-modal-tile-name">${escHtml(c.name || `Character ${c.id}`)}</div>
          `;
          tile.addEventListener('click', () => selectCharInModal(c.id, c));
          charGrid.appendChild(tile);
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

  // ── Character modal ────────────────────────────────────────────
  let pendingCharId   = null;
  let pendingCharData = null;

  function openCharModal() {
    pendingCharId   = selectedCharId;
    pendingCharData = null;
    syncCharModalSelection(selectedCharId);
    qs('#cd-char-modal')?.classList.remove('hidden');
  }

  function closeCharModal() {
    qs('#cd-char-modal')?.classList.add('hidden');
  }

  function selectCharInModal(id, charObj) {
    pendingCharId   = id || null;
    pendingCharData = charObj || null;
    syncCharModalSelection(id);
  }

  function syncCharModalSelection(id) {
    document.querySelectorAll('#cd-char-modal-grid .cd-style-modal-tile').forEach(tile => {
      tile.classList.toggle('active', tile.dataset.charId == (id || ''));
    });
    const noneEl = qs('#cd-char-modal-none');
    if (noneEl) noneEl.classList.toggle('active', !id);
  }

  function confirmCharSelection() {
    selectCharacter(pendingCharId, pendingCharData);
    closeCharModal();
  }

  function selectCharacter(id, charObj) {
    selectedCharId = id || null;
    applyCharPickerDisplay(selectedCharId, charObj);
    // Persist to design
    if (activeDesign) {
      fetch(`/api/card-designer/designs/${activeDesign.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ character_id: selectedCharId }),
      }).then(r => r.json()).then(d => {
        activeDesign = d;
        designs = designs.map(x => x.id === d.id ? d : x);
      }).catch(e => console.warn('[card-designer] selectCharacter save error:', e.message));
    }
  }

  function applyCharPickerDisplay(id, charObj) {
    const thumbEl = qs('#cd-char-picker-thumb');
    const nameEl  = qs('#cd-char-picker-name');
    if (!id) {
      if (thumbEl) thumbEl.style.backgroundImage = '';
      if (nameEl)  nameEl.textContent = 'None selected';
      return;
    }
    // Find char data in modal grid if not passed
    if (!charObj) {
      const tile = qs(`#cd-char-modal-grid [data-char-id="${id}"]`);
      if (tile) {
        const img  = tile.querySelector('img');
        const name = tile.querySelector('.cd-style-modal-tile-name')?.textContent || '';
        if (thumbEl && img) thumbEl.style.backgroundImage = `url(${img.src})`;
        if (nameEl) nameEl.textContent = name;
        return;
      }
    }
    const img = (charObj?.images || [])[0] || null;
    if (thumbEl) thumbEl.style.backgroundImage = img ? `url(${img})` : '';
    if (nameEl)  nameEl.textContent = charObj?.name || `Character ${id}`;
  }

  function applyCharSelection(id) {
    selectedCharId = id || null;
    applyCharPickerDisplay(selectedCharId, null);
    syncCharModalSelection(selectedCharId);
  }

  // ── Settings ───────────────────────────────────────────────────
  // CD settings (gemini model, copy instructions, sketch prompt) are saved
  // by the main handleSettingsSave() in app.js. Only the Gemini key has
  // its own inline save button here.

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

  // ── Cover Style Picker ─────────────────────────────────────────
  async function loadCoverStylesForPicker() {
    try {
      const res = await fetch('/api/cover-styles');
      const styles = await res.json();
      const sel = qs('#cd-cover-style-select');
      if (!sel) return;
      sel.innerHTML = '<option value="">— None —</option>';
      styles.filter(s => s.status === 'active').forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id;
        opt.textContent = s.name;
        sel.appendChild(opt);
      });
      // Restore saved selection
      if (activeDesign?.selected_cover_style_id) {
        sel.value = activeDesign.selected_cover_style_id;
        updateCoverStylePickerPreview(styles.find(s => String(s.id) === String(activeDesign.selected_cover_style_id)));
      } else {
        updateCoverStylePickerPreview(null);
      }
      // Store for preview lookup
      window._coverStylesCache = styles;
    } catch (e) { console.warn('Could not load cover styles:', e); }
  }

  async function onCoverStyleChange(id) {
    if (!activeDesign) return;
    try {
      const resp = await fetch(`/api/card-designer/designs/${activeDesign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selected_cover_style_id: id || '' }),
      });
      activeDesign = await resp.json();
      designs = designs.map(d => d.id === activeDesign.id ? activeDesign : d);
      const style = id ? (window._coverStylesCache || []).find(s => String(s.id) === String(id)) : null;
      updateCoverStylePickerPreview(style);
    } catch (e) { console.warn('Cover style save error:', e); }
  }

  function updateCoverStylePickerPreview(style) {
    const preview = qs('#cd-cover-style-preview');
    const img = qs('#cd-cover-style-preview-img');
    if (!preview || !img) return;
    if (style && style.images && style.images.length) {
      img.src = style.images[0];
      preview.classList.remove('hidden');
    } else {
      preview.classList.add('hidden');
      img.src = '';
    }
  }

  // ── Init ───────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
