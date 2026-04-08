/* ============================================================
   script_onebyone.js  —  Modo Una Pregunta Por Vez
   
   CÓMO INTEGRAR:
   Agregar este script DESPUÉS de script.js en index.html:
      <script src="script.js"></script>
      <script src="script_onebyone.js"></script>
   ============================================================ */

(function () {
  'use strict';

  // ── URL base para imágenes (mismo criterio que script.js) ──
  const IMAGENES_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.'))
    ? ''
    : 'https://examenesiar.github.io/';

  function getImagenUrl(path) {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    return IMAGENES_BASE_URL + path;
  }


  /* ── Inyectar estilos ── */
  const STYLE_ID = 'iar-onebyone-styles';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,wght@0,400;0,500;0,600;0,700;1,400&family=Lora:ital,wght@0,400;0,500;0,600;1,400&display=swap');

      /* ── Variables ── */
      .oav-wrapper {
        font-family: 'DM Sans', system-ui, sans-serif;
        max-width: 780px;
        margin: 0 auto;
        padding: 0 0 32px;
        --oav-blue:    #2563eb;
        --oav-blue-dk: #1d4ed8;
        --oav-blue-lt: #eff6ff;
        --oav-green:   #059669;
        --oav-green-lt:#ecfdf5;
        --oav-red:     #dc2626;
        --oav-red-lt:  #fff1f2;
        --oav-border:  #e2e8f0;
        --oav-text:    #1e293b;
        --oav-muted:   #64748b;
        --oav-radius:  12px;
        --oav-shadow:  0 2px 16px rgba(37,99,235,0.07), 0 1px 3px rgba(0,0,0,0.05);
      }

      /* ── Header de progreso ── */
      .oav-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 12px;
        padding: 10px 14px;
        background: #fff;
        border-radius: var(--oav-radius);
        box-shadow: var(--oav-shadow);
        border: 1px solid var(--oav-border);
      }
      .oav-counter {
        flex-shrink: 0;
        display: flex;
        align-items: baseline;
        gap: 3px;
        min-width: 0;
      }
      .oav-counter-num {
        font-size: 1.2rem;
        font-weight: 700;
        color: var(--oav-blue);
        line-height: 1;
        letter-spacing: -0.5px;
      }
      .oav-counter-total {
        font-size: 0.68rem;
        color: var(--oav-muted);
        font-weight: 500;
        white-space: nowrap;
      }
      .oav-header-divider {
        width: 1px;
        height: 24px;
        background: var(--oav-border);
        flex-shrink: 0;
      }
      .oav-progress-col {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 5px;
        min-width: 0;
      }
      .oav-stats {
        display: flex;
        gap: 5px;
        flex-wrap: wrap;
      }
      .oav-chip {
        display: inline-flex;
        align-items: center;
        gap: 3px;
        padding: 1px 7px;
        border-radius: 100px;
        font-size: 0.65rem;
        font-weight: 600;
        letter-spacing: 0.01em;
        line-height: 1.6;
      }
      .oav-chip-correct  { background: var(--oav-green-lt); color: var(--oav-green); border: 1px solid #a7f3d0; }
      .oav-chip-wrong    { background: var(--oav-red-lt);   color: var(--oav-red);   border: 1px solid #fecaca; }
      .oav-chip-pending  { background: #f1f5f9; color: var(--oav-muted); border: 1px solid #e2e8f0; }
      .oav-chip-pending-active {
        background: #fefce8;
        color: #92400e;
        border: 1px solid #fde68a;
        cursor: pointer;
        transition: all 0.15s ease;
        user-select: none;
      }
      .oav-chip-pending-active:hover {
        background: #fef08a;
        border-color: #eab308;
        color: #713f12;
        transform: translateY(-1px);
        box-shadow: 0 2px 6px rgba(234,179,8,0.25);
      }
      .oav-chip-pending-active:active { transform: scale(0.96); }
      .oav-bar-track {
        width: 100%;
        height: 5px;
        background: #f1f5f9;
        border-radius: 100px;
        overflow: hidden;
        position: relative;
      }
      .oav-bar-fill {
        position: absolute;
        left: 0; top: 0; bottom: 0;
        border-radius: 100px;
        transition: width 0.45s cubic-bezier(.4,0,.2,1);
      }
      .oav-bar-correct  { background: linear-gradient(90deg, #059669, #34d399); }
      .oav-bar-wrong    { background: linear-gradient(90deg, #dc2626, #f87171); }
      .oav-bar-answered { background: linear-gradient(90deg, #2563eb, #60a5fa); }
      .oav-status-icon {
        flex-shrink: 0;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.85rem;
        font-weight: 700;
        transition: all 0.3s ease;
      }
      .oav-status-unanswered { background: #f1f5f9; border: 2px dashed #cbd5e1; color: #94a3b8; }
      .oav-status-correct    { background: var(--oav-green-lt); border: 2px solid #34d399; color: var(--oav-green); }
      .oav-status-wrong      { background: var(--oav-red-lt);   border: 2px solid #f87171; color: var(--oav-red); }

      /* ── Card principal ── */
      .oav-card {
        background: #fff;
        border-radius: var(--oav-radius);
        box-shadow: var(--oav-shadow);
        border: 1px solid var(--oav-border);
        overflow: hidden;
        animation: oav-slide-in 0.22s cubic-bezier(.4,0,.2,1);
      }
      @keyframes oav-slide-in {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .oav-card-body { padding: 18px 20px 14px; }
      .oav-question-label {
        font-size: 0.68rem;
        font-family: 'DM Sans', sans-serif;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--oav-blue);
        display: block;
        margin-bottom: 6px;
      }
      .oav-question-text {
        font-family: 'Lora', Georgia, serif;
        font-size: 0.96rem;
        line-height: 1.58;
        color: var(--oav-text);
        margin-bottom: 14px;
      }
      .oav-question-img {
        display: block;
        max-width: 100%;
        height: auto;
        border-radius: 8px;
        border: 1px solid var(--oav-border);
        margin: 0 auto 14px;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0,0,0,0.07);
        transition: opacity 0.2s;
      }
      .oav-question-img:hover { opacity: 0.88; }

      /* ── Opciones ── */
      .oav-options {
        display: flex;
        flex-direction: column;
        gap: 6px;
        margin-bottom: 0;
      }
      .oav-option {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 13px;
        border-radius: 8px;
        border: 1.5px solid var(--oav-border);
        background: #fafafa;
        cursor: pointer;
        transition: all 0.15s ease;
        position: relative;
        user-select: none;
      }
      .oav-option:hover:not(.oav-option-disabled) {
        border-color: var(--oav-blue);
        background: var(--oav-blue-lt);
        transform: translateX(2px);
      }
      .oav-option.oav-option-selected:not(.oav-option-disabled) {
        border-color: var(--oav-blue);
        background: var(--oav-blue-lt);
      }
      .oav-option.oav-option-correct {
        border-color: #059669 !important;
        background: var(--oav-green-lt) !important;
      }
      .oav-option.oav-option-wrong {
        border-color: #dc2626 !important;
        background: var(--oav-red-lt) !important;
      }
      .oav-option.oav-option-disabled { cursor: default; }

      .oav-option-letter {
        flex-shrink: 0;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 1.5px solid #cbd5e1;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.65rem;
        font-weight: 700;
        color: var(--oav-muted);
        transition: all 0.15s ease;
      }
      .oav-option:hover:not(.oav-option-disabled) .oav-option-letter,
      .oav-option.oav-option-selected .oav-option-letter {
        color: var(--oav-blue);
        border-color: var(--oav-blue);
        background: var(--oav-blue-lt);
      }
      .oav-option.oav-option-correct .oav-option-letter {
        color: var(--oav-green) !important;
        border-color: var(--oav-green) !important;
        background: #d1fae5 !important;
      }
      .oav-option.oav-option-wrong .oav-option-letter {
        color: var(--oav-red) !important;
        border-color: var(--oav-red) !important;
        background: #fee2e2 !important;
      }
      .oav-option input[type="radio"],
      .oav-option input[type="checkbox"] {
        position: absolute;
        opacity: 0;
        pointer-events: none;
        width: 0; height: 0;
      }
      .oav-option-text {
        flex: 1;
        font-size: 0.87rem;
        line-height: 1.45;
        color: var(--oav-text);
      }
      .oav-option-icon {
        flex-shrink: 0;
        font-size: 0.85rem;
        opacity: 0;
        transition: opacity 0.2s;
        font-weight: 700;
      }
      .oav-option.oav-option-correct .oav-option-icon { opacity: 1; color: var(--oav-green); }
      .oav-option.oav-option-wrong    .oav-option-icon { opacity: 1; color: var(--oav-red); }

      /* ── Badge resultado ── */
      .oav-result-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 11px;
        border-radius: 100px;
        font-size: 0.75rem;
        font-weight: 700;
        margin-top: 10px;
        letter-spacing: 0.02em;
        animation: oav-pop 0.25s cubic-bezier(.4,0,.2,1);
      }
      @keyframes oav-pop {
        from { opacity: 0; transform: scale(0.88); }
        to   { opacity: 1; transform: scale(1); }
      }
      .oav-result-correct { background: var(--oav-green-lt); color: var(--oav-green); border: 1.5px solid #a7f3d0; }
      .oav-result-wrong   { background: var(--oav-red-lt);   color: var(--oav-red);   border: 1.5px solid #fecaca; }

      /* ── Footer de la card ── */
      .oav-card-footer {
        padding: 11px 20px 16px;
        border-top: 1px solid var(--oav-border);
        display: flex;
        flex-direction: column;
        gap: 8px;
        background: #fafbfc;
      }
      .oav-btn-row { display: flex; gap: 8px; flex-wrap: wrap; }
      .oav-btn {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 8px 18px;
        border-radius: 7px;
        font-family: 'DM Sans', sans-serif;
        font-size: 0.83rem;
        font-weight: 600;
        cursor: pointer;
        border: none;
        transition: all 0.15s ease;
        letter-spacing: 0.01em;
      }
      .oav-btn:active { transform: scale(0.97); }
      .oav-btn-primary {
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
        color: #fff;
        box-shadow: 0 2px 6px rgba(37,99,235,0.25);
      }
      .oav-btn-primary:hover:not(:disabled) {
        background: linear-gradient(135deg, #1d4ed8 0%, #1e3a8a 100%);
        box-shadow: 0 4px 10px rgba(37,99,235,0.32);
        transform: translateY(-1px);
      }
      .oav-btn-primary:disabled { opacity: 0.42; cursor: not-allowed; box-shadow: none; transform: none; }
      .oav-btn-ghost {
        background: transparent;
        color: var(--oav-blue);
        border: 1.5px solid #bfdbfe;
        font-size: 0.81rem;
      }
      .oav-btn-ghost:hover:not(:disabled) { background: var(--oav-blue-lt); border-color: var(--oav-blue); }
      .oav-btn-ghost:disabled { opacity: 0.38; cursor: not-allowed; }

      /* ── Explicación ── */
      .oav-explanation {
        padding: 10px 14px;
        border-radius: 8px;
        background: linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%);
        border-left: 3px solid var(--oav-blue);
        animation: oav-slide-in 0.25s ease;
      }
      .oav-explanation-title {
        font-size: 0.67rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--oav-blue);
        margin-bottom: 5px;
      }
      .oav-explanation-text {
        font-size: 0.85rem;
        line-height: 1.58;
        color: var(--oav-text);
        margin: 0;
      }
      .oav-explanation img {
        display: block;
        max-width: 100%;
        border-radius: 6px;
        margin-top: 10px;
        cursor: pointer;
        border: 1px solid var(--oav-border);
      }

      /* ── Navegación ── */
      .oav-nav {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-top: 10px;
      }
      .oav-nav-btn {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 9px 16px;
        border-radius: 8px;
        font-family: 'DM Sans', sans-serif;
        font-size: 0.83rem;
        font-weight: 600;
        cursor: pointer;
        border: 1.5px solid var(--oav-border);
        background: #fff;
        color: var(--oav-text);
        transition: all 0.15s ease;
        box-shadow: var(--oav-shadow);
        white-space: nowrap;
      }
      .oav-nav-btn:hover:not(:disabled) {
        border-color: var(--oav-blue);
        color: var(--oav-blue);
        background: var(--oav-blue-lt);
        transform: translateY(-1px);
      }
      .oav-nav-btn:disabled { opacity: 0.32; cursor: not-allowed; box-shadow: none; transform: none; }
      .oav-nav-btn-next {
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
        color: #fff;
        border-color: transparent;
        box-shadow: 0 2px 6px rgba(37,99,235,0.25);
      }
      .oav-nav-btn-next:hover:not(:disabled) {
        background: linear-gradient(135deg, #1d4ed8 0%, #1e3a8a 100%);
        color: #fff;
        border-color: transparent;
        box-shadow: 0 4px 10px rgba(37,99,235,0.32);
        transform: translateY(-1px);
      }

      /* ── Mini-mapa: barra de segmentos horizontal ── */
      .oav-minimap {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 2px;
        overflow: hidden;
        min-width: 0;
      }
      .oav-dot {
        flex: 1;
        height: 6px;
        border-radius: 100px;
        background: #e2e8f0;
        cursor: pointer;
        transition: all 0.15s ease;
        position: relative;
        min-width: 4px;
      }
      .oav-dot:hover         { background: #93c5fd; transform: scaleY(1.5); }
      .oav-dot-current       { background: var(--oav-blue); transform: scaleY(1.8); border-radius: 4px; }
      .oav-dot-correct       { background: var(--oav-green); }
      .oav-dot-wrong         { background: var(--oav-red); }
      .oav-dot-pending-pulse {
        animation: oav-dot-pulse 1.8s ease-in-out infinite;
      }
      @keyframes oav-dot-pulse {
        0%, 100% { background: #e2e8f0; transform: scaleY(1);   }
        50%       { background: #fbbf24; transform: scaleY(1.7); }
      }
      .oav-dot::after {
        content: attr(data-num);
        position: absolute;
        bottom: calc(100% + 5px);
        left: 50%;
        transform: translateX(-50%);
        background: #1e293b;
        color: #fff;
        font-size: 0.6rem;
        font-weight: 700;
        padding: 2px 5px;
        border-radius: 4px;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.15s;
        font-family: 'DM Sans', sans-serif;
      }
      .oav-dot:hover::after  { opacity: 1; }
      .oav-dot-current::after { opacity: 1; background: var(--oav-blue); }

      /* ── Pantalla resultado final ── */
      .oav-result-screen {
        background: #fff;
        border-radius: var(--oav-radius);
        box-shadow: var(--oav-shadow);
        border: 1px solid var(--oav-border);
        padding: 28px 24px;
        text-align: center;
        animation: oav-slide-in 0.3s ease;
      }
      .oav-result-icon   { font-size: 2.8rem; margin-bottom: 8px; line-height: 1; }
      .oav-result-score  { font-size: 2.2rem; font-weight: 700; color: var(--oav-blue); letter-spacing: -1px; line-height: 1; margin-bottom: 3px; }
      .oav-result-label  { font-size: 0.82rem; color: var(--oav-muted); font-weight: 500; margin-bottom: 18px; }
      .oav-result-bar-wrap {
        height: 8px;
        background: #f1f5f9;
        border-radius: 100px;
        overflow: hidden;
        margin-bottom: 18px;
        max-width: 280px;
        margin-left: auto;
        margin-right: auto;
      }
      .oav-result-bar-fill { height: 100%; border-radius: 100px; transition: width 1s cubic-bezier(.4,0,.2,1); }
      .oav-result-phrase {
        font-size: 0.88rem;
        line-height: 1.6;
        color: var(--oav-text);
        background: var(--oav-blue-lt);
        border-left: 3px solid var(--oav-blue);
        border-radius: 8px;
        padding: 11px 14px;
        text-align: left;
        margin-bottom: 20px;
      }
      .oav-result-actions { display: flex; gap: 10px; justify-content: center; flex-wrap: wrap; }

      /* ── Responsive mobile ── */
      @media (max-width: 540px) {
        .oav-card-body    { padding: 14px 14px 11px; }
        .oav-card-footer  { padding: 9px 14px 13px; }
        .oav-question-text { font-size: 0.91rem; }
        .oav-option-text  { font-size: 0.84rem; }
        .oav-header       { padding: 8px 11px; gap: 8px; }
        .oav-counter-num  { font-size: 1.05rem; }
        .oav-nav-btn      { padding: 8px 12px; font-size: 0.79rem; }
        .oav-result-screen { padding: 20px 14px; }
        .oav-result-score  { font-size: 1.8rem; }
        .oav-dot           { height: 5px; }
      }
    `;
    document.head.appendChild(style);
  }

  /* ─────────────────────────────────────────────────────────
     ESTADO
  ───────────────────────────────────────────────────────── */
  const oavState = {};
  window.oavState = oavState;

  // Marcas temporales de sesión: { [seccionId]: { [qIndex]: [texto1, texto2, ...] } }
  const _sessionMarks = {};
  window._oavSessionMarks = _sessionMarks;

  function _getSessionMark(seccionId, qIndex) {
    return (_sessionMarks[seccionId] && _sessionMarks[seccionId][qIndex]) || [];
  }
  function _setSessionMark(seccionId, qIndex, textos) {
    if (!_sessionMarks[seccionId]) _sessionMarks[seccionId] = {};
    _sessionMarks[seccionId][qIndex] = textos;
  }
  function _clearSessionMarks(seccionId) {
    delete _sessionMarks[seccionId];
  }
  window._oavGetCurrentIdx = function(seccionId) {
    if (!oavState[seccionId]) return null;
    var idx = oavState[seccionId].currentIdx;
    return (typeof idx === 'number') ? idx : null;
  };
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const OAV_NAV_KEY = 'oav_current_idx_v1';

  function _saveCurrentIdx(seccionId, idx) {
    try {
      const all = JSON.parse(localStorage.getItem(OAV_NAV_KEY) || '{}');
      all[seccionId] = idx;
      localStorage.setItem(OAV_NAV_KEY, JSON.stringify(all));
    } catch(e) {}
  }
  function _loadCurrentIdx(seccionId) {
    try {
      const all = JSON.parse(localStorage.getItem(OAV_NAV_KEY) || '{}');
      return typeof all[seccionId] === 'number' ? all[seccionId] : null;
    } catch(e) { return null; }
  }
  function _clearCurrentIdx(seccionId) {
    try {
      const all = JSON.parse(localStorage.getItem(OAV_NAV_KEY) || '{}');
      delete all[seccionId];
      localStorage.setItem(OAV_NAV_KEY, JSON.stringify(all));
    } catch(e) {}
  }

  /* ─────────────────────────────────────────────────────────
     HELPERS
  ───────────────────────────────────────────────────────── */
  function isOAVSection(seccionId) {
    if (!seccionId) return false;
    const esIAR = seccionId.startsWith('iar') || seccionId.toLowerCase().includes('iar');
    const esSimulacro = seccionId === 'simulacro_iar';
    return esIAR || esSimulacro;
  }

  function getQuizState(seccionId) {
    try {
      const raw = localStorage.getItem('quiz_state_v3');
      if (!raw) return null;
      return JSON.parse(raw)[seccionId] || null;
    } catch (e) { return null; }
  }

  function getScores(seccionId) {
    if (window.puntajesPorSeccion && window.puntajesPorSeccion[seccionId]) {
      const scores = window.puntajesPorSeccion[seccionId];
      const tieneAlgo = scores.some(v => v !== null && v !== undefined);
      if (tieneAlgo) return scores;
    }

    const preguntas = window.preguntasPorSeccion && window.preguntasPorSeccion[seccionId];
    if (!preguntas || preguntas.length === 0) return [];

    const s = getQuizState(seccionId);
    if (!s || !s.graded || !s.shuffleMap) return Array(preguntas.length).fill(null);

    const scores = Array(preguntas.length).fill(null);
    preguntas.forEach(function(preg, idx) {
      if (!s.graded[idx]) return;
      const inv = s.shuffleMap[idx];
      if (!inv) return;
      const guardadas = (s.answers && s.answers[idx]) || [];
      const selOriginal = guardadas.map(function(mi) { return inv[mi]; }).sort(function(a,b){return a-b;});
      const correctaOriginal = preg.correcta.slice().sort(function(a,b){return a-b;});
      scores[idx] = JSON.stringify(selOriginal) === JSON.stringify(correctaOriginal) ? 1 : 0;
    });

    if (!window.puntajesPorSeccion) window.puntajesPorSeccion = {};
    window.puntajesPorSeccion[seccionId] = scores;
    return scores;
  }

  function getQuestionStatus(seccionId, idx) {
    const v = getScores(seccionId)[idx];
    if (v === null || v === undefined) return 'pending';
    return v === 1 ? 'correct' : 'wrong';
  }

  function getShuffledOptions(seccionId, idx, opciones) {
    const s = getQuizState(seccionId);
    const isGraded = s && s.graded && s.graded[idx];

    if (isGraded && s.shuffleMap && s.shuffleMap[idx]) {
      const inv = s.shuffleMap[idx];
      return Object.keys(inv).sort((a, b) => +a - +b).map(k => ({
        text: opciones[inv[k]], originalIndex: inv[k], mixedIndex: +k
      }));
    }

    var indices = opciones.map(function(_, i) { return i; });
    var seed = (Date.now() + idx * 7919 + (Math.random() * 1e9 | 0)) >>> 0;
    function rng() {
      seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5;
      return (seed >>> 0) / 0xFFFFFFFF;
    }
    for (var i = indices.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = indices[i]; indices[i] = indices[j]; indices[j] = tmp;
    }

    return indices.map(function(origIdx, mixedIdx) {
      return { text: opciones[origIdx], originalIndex: origIdx, mixedIndex: mixedIdx };
    });
  }

  function getRestoredAnswers(seccionId, idx, shuffledOptions) {
    const s = getQuizState(seccionId);
    const isGraded = s && s.graded && s.graded[idx];

    if (isGraded) {
      if (!s || !s.answers || !s.answers[idx]) return [];
      return s.answers[idx];
    }

    const sessionTextos = _getSessionMark(seccionId, idx);
    if (!sessionTextos || sessionTextos.length === 0) return [];

    const marcados = [];
    if (shuffledOptions) {
      sessionTextos.forEach(function(texto) {
        const opt = shuffledOptions.find(function(o) { return o.text === texto; });
        if (opt !== undefined) marcados.push(opt.mixedIndex);
      });
    }
    return marcados;
  }

  function escapeHTML(str) {
    if (typeof str !== 'string') return String(str || '');
    return str
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* ─────────────────────────────────────────────────────────
     RENDER PRINCIPAL
  ───────────────────────────────────────────────────────── */
  function renderOAV(seccionId) {
    const preguntas = window.preguntasPorSeccion && window.preguntasPorSeccion[seccionId];
    if (!preguntas || preguntas.length === 0) return;

    const cont = document.getElementById('cuestionario-' + seccionId);
    if (!cont) return;

    const esCargaNueva = !oavState[seccionId];
    if (esCargaNueva) {
      _clearSessionMarks(seccionId);
    }

    if (!oavState[seccionId]) {
      oavState[seccionId] = { currentIdx: 0, total: preguntas.length };
    } else {
      oavState[seccionId].total = preguntas.length;
    }

    const scores = getScores(seccionId);
    const allAnswered = scores.length === preguntas.length && scores.every(v => v !== null && v !== undefined);

    if (typeof window._buscadorTargetIdx === 'number' && window._buscadorTargetIdx >= 0) {
      oavState[seccionId].currentIdx = window._buscadorTargetIdx;
      window._buscadorTargetIdx = null;
      _clearCurrentIdx(seccionId);
    }
    else if (!allAnswered) {
      const savedIdx = _loadCurrentIdx(seccionId);
      if (savedIdx !== null && savedIdx >= 0 && savedIdx < preguntas.length) {
        oavState[seccionId].currentIdx = savedIdx;
      } else {
        const firstUnanswered = preguntas.findIndex((_, i) => {
          const v = scores[i]; return v === null || v === undefined;
        });
        if (firstUnanswered >= 0) oavState[seccionId].currentIdx = firstUnanswered;
      }
    } else {
      oavState[seccionId].currentIdx = 0;
      _clearCurrentIdx(seccionId);
    }

    cont.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'oav-wrapper';
    wrapper.id = 'oav-wrapper-' + seccionId;
    cont.appendChild(wrapper);

    const _desdeBuscador = typeof window._buscadorQueryPendiente === 'string';
    if (allAnswered && !_desdeBuscador) {
      _mostrarResultadoFinalOAV(seccionId);
    } else {
      renderOAVPage(seccionId);
    }
  }

  function renderOAVPage(seccionId) {
    const wrapper = document.getElementById('oav-wrapper-' + seccionId);
    if (!wrapper) return;

    const preguntas = window.preguntasPorSeccion[seccionId];
    const st = oavState[seccionId];
    if (!st) return;

    const idx   = st.currentIdx;
    const total = st.total;
    const preg  = preguntas[idx];
    if (!preg) return;

    const scores   = getScores(seccionId);
    const answered = scores.filter(v => v !== null && v !== undefined).length;
    const correct  = scores.filter(v => v === 1).length;
    const wrong    = scores.filter(v => v === 0).length;
    const pct      = total > 0 ? (answered / total) * 100 : 0;

    const qStatus  = getQuestionStatus(seccionId, idx);
    const isGraded = qStatus !== 'pending';

    const shuffled      = getShuffledOptions(seccionId, idx, preg.opciones);
    const restoredMixed = getRestoredAnswers(seccionId, idx, shuffled);
    const tipoInput     = preg.multiple ? 'checkbox' : 'radio';
    const qs  = getQuizState(seccionId);
    const inv = qs && qs.shuffleMap && qs.shuffleMap[idx];

    const barClass    = correct > 0 ? 'oav-bar-correct' : (wrong > 0 ? 'oav-bar-wrong' : 'oav-bar-answered');
    const statusClass = qStatus === 'correct' ? 'oav-status-correct' : qStatus === 'wrong' ? 'oav-status-wrong' : 'oav-status-unanswered';
    const statusIcon  = qStatus === 'correct' ? '✓' : qStatus === 'wrong' ? '✗' : '?';

    let opcionesHTML = '';
    shuffled.forEach((opt, mi) => {
      const isSelected = restoredMixed.includes(opt.mixedIndex);
      let optClass = '';
      let optIcon  = '';
      if (isGraded && inv) {
        const isCorrectOpt  = preg.correcta.includes(opt.originalIndex);
        const isSelectedOpt = restoredMixed.includes(opt.mixedIndex);
        if (isCorrectOpt)                        { optClass = 'oav-option-correct'; optIcon = '✓'; }
        else if (isSelectedOpt && !isCorrectOpt) { optClass = 'oav-option-wrong';   optIcon = '✗'; }
      } else if (isSelected) {
        optClass = 'oav-option-selected';
      }
      const disabledClass = isGraded ? ' oav-option-disabled' : '';

      opcionesHTML += `
        <label class="oav-option ${optClass}${disabledClass}"
               data-mixed="${opt.mixedIndex}" data-original="${opt.originalIndex}"
               for="oav-opt-${seccionId}-${idx}-${mi}">
          <input
            type="${tipoInput}"
            id="oav-opt-${seccionId}-${idx}-${mi}"
            name="pregunta${seccionId}${idx}"
            value="${opt.mixedIndex}"
            data-original-index="${opt.originalIndex}"
            ${isSelected ? 'checked' : ''}
            ${isGraded ? 'disabled' : ''}
          >
          <span class="oav-option-letter">${LETTERS[mi]}</span>
          <span class="oav-option-text">${escapeHTML(opt.text)}</span>
          <span class="oav-option-icon">${optIcon}</span>
        </label>`;
    });

    let resultBadgeHTML = '';
    if (isGraded) {
      resultBadgeHTML = qStatus === 'correct'
        ? '<span class="oav-result-badge oav-result-correct">✓ Correcto (+1)</span>'
        : '<span class="oav-result-badge oav-result-wrong">✗ Incorrecto (0)</span>';
    }

    const expShown = qs && qs.explanationShown && qs.explanationShown[idx];
    let explicacionHTML = '';
    if (preg.explicacion && preg.explicacion.trim() !== '') {
      const expContent = expShown ? `
        <div class="oav-explanation" id="oav-exp-${seccionId}-${idx}">
          <div class="oav-explanation-title">💡 Explicación</div>
          <p class="oav-explanation-text">${escapeHTML(preg.explicacion)}</p>
          ${preg.imagen_explicacion ? `<img src="${getImagenUrl(preg.imagen_explicacion)}" alt="Imagen de la explicación" onclick="window.open(this.src,'_blank')" title="Clic para ampliar">` : ''}
        </div>` : '';
      const expBtnText     = expShown ? 'Ocultar explicación' : 'Ver explicación';
      const expBtnDisabled = !isGraded ? 'disabled' : '';
      explicacionHTML = `
        <button class="oav-btn oav-btn-ghost" id="oav-btn-exp-${seccionId}-${idx}"
                ${expBtnDisabled}
                onclick="window._oavToggleExplicacion('${seccionId}',${idx})">
          💬 ${expBtnText}
        </button>
        ${expContent}`;
    }

    let minimapHTML = '<div class="oav-minimap" title="Navegá entre preguntas">';
    for (let i = 0; i < total; i++) {
      const st2 = getQuestionStatus(seccionId, i);
      const isPending = st2 === 'pending';
      const isCurrentPending = isPending && i === idx;
      const dotClass = i === idx         ? 'oav-dot-current' :
                       st2 === 'correct' ? 'oav-dot-correct' :
                       st2 === 'wrong'   ? 'oav-dot-wrong'   :
                       isPending         ? 'oav-dot-pending-pulse' : '';
      minimapHTML += `<div class="oav-dot ${dotClass}" data-num="${i+1}" onclick="window._oavGoTo('${seccionId}',${i})"></div>`;
    }
    minimapHTML += '</div>';

    const pending = total - answered;
    const firstPendingIdx = pending > 0
      ? Array.from({length: total}, (_, i) => i).find(i => {
          const v = scores[i]; return (v === null || v === undefined) && i !== idx;
        })
      : null;
    const jumpToPending = firstPendingIdx !== null && firstPendingIdx !== undefined
      ? firstPendingIdx
      : (pending > 0 ? Array.from({length: total}, (_, i) => i).find(i => {
          const v = scores[i]; return v === null || v === undefined;
        }) : null);

    const pendingChipHTML = pending > 0
      ? `<span class="oav-chip oav-chip-pending-active"
               title="Ir a la primera pregunta sin responder"
               onclick="window._oavGoTo('${seccionId}', ${jumpToPending})">
           ⚡ ${pending} sin responder
         </span>`
      : `<span class="oav-chip oav-chip-pending">✓ todas respondidas</span>`;

    wrapper.innerHTML = `
      <div class="oav-header">
        <div class="oav-counter">
          <span class="oav-counter-num">${idx + 1}</span>
          <span class="oav-counter-total">de&nbsp;${total}</span>
        </div>
        <div class="oav-header-divider"></div>
        <div class="oav-progress-col">
          <div class="oav-stats">
            <span class="oav-chip oav-chip-correct">✓ ${correct} correctas</span>
            <span class="oav-chip oav-chip-wrong">✗ ${wrong} incorrectas</span>
            ${pendingChipHTML}
          </div>
          <div class="oav-bar-track">
            <div class="oav-bar-fill ${barClass}" style="width:${pct}%"></div>
          </div>
        </div>
        <div class="oav-status-icon ${statusClass}">${statusIcon}</div>
      </div>

      <div class="oav-card">
        <div class="oav-card-body">
          <span class="oav-question-label">Pregunta ${idx + 1}</span>
          <div class="oav-question-text">${escapeHTML(preg.pregunta)}</div>
          ${preg.imagen ? `<img class="oav-question-img" src="${getImagenUrl(preg.imagen)}" alt="Imagen" onclick="window.open(this.src,'_blank')" title="Clic para ampliar">` : ''}
          <div class="oav-options" id="oav-options-${seccionId}-${idx}">
            ${opcionesHTML}
          </div>
          ${resultBadgeHTML}
        </div>
        <div class="oav-card-footer">
          <div class="oav-btn-row">
            <button class="oav-btn oav-btn-primary"
                    ${isGraded ? 'disabled' : ''}
                    onclick="window._oavResponder('${seccionId}',${idx})">
              ✓ Responder
            </button>
            ${explicacionHTML}
          </div>
        </div>
      </div>

      <div class="oav-nav">
        <button class="oav-nav-btn"
                onclick="window._oavGoTo('${seccionId}',(${idx} - 1 + ${total}) % ${total})">
          ← Anterior
        </button>
        ${minimapHTML}
        <button class="oav-nav-btn oav-nav-btn-next"
                onclick="window._oavGoTo('${seccionId}',(${idx} + 1) % ${total})">
          Siguiente →
        </button>
      </div>
      ${st.isReviewing ? `
      <div style="display:flex;justify-content:center;margin-top:14px;">
        <button class="oav-btn oav-btn-ghost" onclick="window._oavSalirRevision('${seccionId}')">
          Salir de la revisión 🔍
        </button>
      </div>` : ''}
    `;

    const optContainer = document.getElementById('oav-options-' + seccionId + '-' + idx);
    if (optContainer && !isGraded) {
      optContainer.querySelectorAll('input').forEach(inp => {
        inp.addEventListener('change', () => {
          optContainer.querySelectorAll('.oav-option').forEach(lbl => lbl.classList.remove('oav-option-selected'));
          if (tipoInput === 'radio') {
            inp.closest('.oav-option').classList.add('oav-option-selected');
          } else {
            optContainer.querySelectorAll('input:checked').forEach(ci => {
              ci.closest('.oav-option').classList.add('oav-option-selected');
            });
          }
          _persistAnswers(seccionId, idx);
        });
      });
    }

    if (window._buscadorQueryPendiente) {
      var query = window._buscadorQueryPendiente;
      window._buscadorQueryPendiente = null;
      requestAnimationFrame(function() {
        _resaltarTextoBuscadoOAV(wrapper, query);
        wrapper.classList.add('buscador-highlight');
        setTimeout(function() { wrapper.classList.remove('buscador-highlight'); }, 2500);
      });
    }

    if (typeof window._oavRenderComentarios === 'function' && seccionId !== 'simulacro_iar') {
      window._oavRenderComentarios(seccionId, idx);
    }
  }

  /* ─────────────────────────────────────────────────────────
     PERSISTENCIA LOCAL
  ───────────────────────────────────────────────────────── */
  function _persistAnswers(seccionId, qIndex) {
    try {
      const inputs = Array.from(document.getElementsByName('pregunta' + seccionId + qIndex));
      const textos = inputs
        .filter(inp => inp.checked)
        .map(inp => {
          const lbl = inp.closest('.oav-option');
          return lbl ? lbl.querySelector('.oav-option-text').textContent : '';
        })
        .filter(t => t !== '');
      _setSessionMark(seccionId, qIndex, textos);
    } catch (e) {}
  }

  /* ─────────────────────────────────────────────────────────
     ACCIONES GLOBALES
  ───────────────────────────────────────────────────────── */
  window._oavGoTo = function (seccionId, idx) {
    const st = oavState[seccionId];
    if (!st) return;
    const total = (window.preguntasPorSeccion[seccionId] || []).length;
    if (idx < 0 || idx >= total) return;
    st.currentIdx = idx;
    _saveCurrentIdx(seccionId, idx);
    renderOAVPage(seccionId);
    const cont = document.getElementById('cuestionario-' + seccionId);
    if (cont) cont.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  window._oavResponder = function (seccionId, qIndex) {
    const preguntas = window.preguntasPorSeccion && window.preguntasPorSeccion[seccionId];
    if (!preguntas) return;
    const preg = preguntas[qIndex];

    const inputs   = Array.from(document.getElementsByName('pregunta' + seccionId + qIndex));
    const selMixed = inputs.map((inp, i) => inp.checked ? i : null).filter(v => v !== null);

    if (selMixed.length === 0) {
      const card = document.querySelector('#oav-wrapper-' + seccionId + ' .oav-card');
      if (card) {
        card.style.boxShadow = '0 0 0 2px #dc2626, 0 4px 24px rgba(220,38,38,0.15)';
        setTimeout(() => { card.style.boxShadow = ''; }, 900);
      }
      return;
    }

    try {
      const raw = localStorage.getItem('quiz_state_v3');
      const all = JSON.parse(raw || '{}');
      if (!all[seccionId]) {
        all[seccionId] = { shuffleMap: {}, answers: {}, graded: {}, explanationShown: {}, shuffleFrozen: false };
      }
      if (!all[seccionId].shuffleMap)       all[seccionId].shuffleMap       = {};
      if (!all[seccionId].answers)          all[seccionId].answers          = {};
      if (!all[seccionId].graded)           all[seccionId].graded           = {};
      if (!all[seccionId].explanationShown) all[seccionId].explanationShown = {};

      const invBuild = {};
      inputs.forEach((inp, mi) => {
        invBuild[mi] = parseInt(inp.getAttribute('data-original-index'), 10);
      });
      all[seccionId].shuffleMap[qIndex] = invBuild;
      all[seccionId].shuffleFrozen = true;

      const inv = invBuild;

      const selOriginal     = selMixed.map(i => inv[i]).sort((a, b) => a - b);
      const correctOriginal = preg.correcta.slice().sort((a, b) => a - b);
      const isCorrect       = JSON.stringify(selOriginal) === JSON.stringify(correctOriginal);

      all[seccionId].answers[qIndex] = selMixed;
      all[seccionId].graded[qIndex]  = true;
      if (all[seccionId].totalShown) {
        all[seccionId].totalShown = false;
      }
      localStorage.setItem('quiz_state_v3', JSON.stringify(all));

      if (_sessionMarks[seccionId]) {
        delete _sessionMarks[seccionId][qIndex];
      }

      if (typeof window._guardarSeccionFirestoreInmediato === 'function') {
        window._guardarSeccionFirestoreInmediato(seccionId);
      } else if (typeof window._guardarSeccionFirestore === 'function') {
        window._guardarSeccionFirestore(seccionId);
      }

      if (!window.puntajesPorSeccion)                window.puntajesPorSeccion          = {};
      if (!window.puntajesPorSeccion[seccionId])     window.puntajesPorSeccion[seccionId] = Array(preguntas.length).fill(null);
      window.puntajesPorSeccion[seccionId][qIndex]   = isCorrect ? 1 : 0;

      if (oavState[seccionId]) {
        _saveCurrentIdx(seccionId, oavState[seccionId].currentIdx);
      }

      renderOAVPage(seccionId);

      const allAnswered = window.puntajesPorSeccion[seccionId].every(v => v !== null && v !== undefined);
      if (allAnswered && !all[seccionId].totalShown) {
        _clearCurrentIdx(seccionId);
        if (seccionId === 'simulacro_iar' && window._simulacroTimer) {
          window._simulacroTimer.limpiar();
        }
        setTimeout(() => _mostrarResultadoFinalOAV(seccionId), 600);
      }

    } catch (e) {
      console.error('[OAV] Error al responder:', e);
    }
  };

  window._oavToggleExplicacion = function (seccionId, qIndex) {
    try {
      const raw = localStorage.getItem('quiz_state_v3');
      const all = JSON.parse(raw || '{}');
      if (!all[seccionId]) return;
      if (!all[seccionId].explanationShown) all[seccionId].explanationShown = {};
      all[seccionId].explanationShown[qIndex] = !all[seccionId].explanationShown[qIndex];
      localStorage.setItem('quiz_state_v3', JSON.stringify(all));
      renderOAVPage(seccionId);
    } catch (e) {}
  };

  window._oavRevisar = function (seccionId) {
    if (!oavState[seccionId]) oavState[seccionId] = { total: 0 };
    oavState[seccionId].currentIdx = 0;
    oavState[seccionId].isReviewing = true;
    renderOAVPage(seccionId);
  };

  window._oavSalirRevision = function (seccionId) {
    if (oavState[seccionId]) oavState[seccionId].isReviewing = false;
    _mostrarResultadoFinalOAV(seccionId);
  };

  window._oavReiniciar = function (seccionId) {
    if (typeof window.reiniciarExamen === 'function') {
      window._oavPendingReiniciarCallback = function() {
        _clearCurrentIdx(seccionId);
        _clearSessionMarks(seccionId);
        if (oavState[seccionId]) {
          oavState[seccionId].currentIdx = 0;
          oavState[seccionId].isReviewing = false;
        }
        if (typeof window._borrarSeccionFirestore === 'function') {
          window._borrarSeccionFirestore(seccionId);
        }
        if (seccionId === 'simulacro_iar' && window._simulacroTimer) {
          window._simulacroTimer.limpiar();
          setTimeout(function() {
            if (window._simulacroTimer) window._simulacroTimer.iniciar();
          }, 1000);
        }
      };
      window.reiniciarExamen(seccionId);
    } else {
      _clearCurrentIdx(seccionId);
      _clearSessionMarks(seccionId);
      try {
        const raw = localStorage.getItem('quiz_state_v3');
        const all = JSON.parse(raw || '{}');
        delete all[seccionId];
        localStorage.setItem('quiz_state_v3', JSON.stringify(all));
      } catch(e) {}
      if (typeof window._borrarSeccionFirestore === 'function') {
        window._borrarSeccionFirestore(seccionId);
      }
      if (window.puntajesPorSeccion) {
        window.puntajesPorSeccion[seccionId] = Array((window.preguntasPorSeccion[seccionId] || []).length).fill(null);
      }
      if (oavState[seccionId]) oavState[seccionId].currentIdx = 0;
      renderOAV(seccionId);
    }
  };

  /* ─────────────────────────────────────────────────────────
     PANTALLA DE RESULTADO FINAL
  ───────────────────────────────────────────────────────── */
  function _mostrarResultadoFinalOAV(seccionId) {
    const preguntas  = window.preguntasPorSeccion[seccionId] || [];
    const total      = preguntas.length;
    const scores     = getScores(seccionId);
    const totalScore = scores.reduce((a, b) => a + (b || 0), 0);
    const pct        = total > 0 ? (totalScore / total) * 100 : 0;
    const barColor   = pct >= 70 ? '#059669' : pct >= 50 ? '#d97706' : '#dc2626';
    const icon       = pct === 100 ? '🏆' : pct >= 70 ? '🌟' : pct >= 50 ? '💪' : '📚';
    const frase      = _localFrase(pct);

    try {
      const raw = localStorage.getItem('quiz_state_v3');
      const all = JSON.parse(raw || '{}');
      if (all[seccionId]) { all[seccionId].totalShown = true; localStorage.setItem('quiz_state_v3', JSON.stringify(all)); }
    } catch(e) {}

    const resultNode = document.getElementById('resultado-total-' + seccionId);
    if (resultNode && !resultNode.dataset.oavFired) {
      resultNode.dataset.oavFired = '1';
      if (typeof window.mostrarResultadoFinal === 'function') {
        window.mostrarResultadoFinal(seccionId);
      }
    }

    const wrapper = document.getElementById('oav-wrapper-' + seccionId);
    if (!wrapper) return;

    const IAR_CARRUSEL_OAV = [
      'iarsep2020','iaroct2020','iarnov2020','iardic2020',
      'iarfeb2021','iarmar2021','iarabr2021','iarmay2021','iarjun2021','iarago2021','iarsep2021','iarnov2021','iardic2021',
      'iarmar2022','iarabr2022','iarjun2022','iarago2022','iaroct2022','iardic2022',
      'iarmar2023','iarabr2023','iarmay2023','iarjun2023','iarago2023','iaroct2023','iardic2023',
      'iarmar2024','iarabr2024','iarmay2024','iarjun2024','iarago2024','iarsep2024','iaroct2024','iarnov2024','iardic2024',
      'iarfeb2025','iarmar2025','iarabr2025','iarjun2025','iarsep2025','iaroct2025','iarnov2025','iardic2025',
      'iarfeb2026'
    ];
    const idxCarrusel = IAR_CARRUSEL_OAV.indexOf(seccionId);
    const siguienteSeccion = idxCarrusel >= 0 && idxCarrusel < IAR_CARRUSEL_OAV.length - 1
      ? IAR_CARRUSEL_OAV[idxCarrusel + 1] : null;
    const btnSiguiente = siguienteSeccion ? `
      <button class="oav-btn oav-btn-primary" onclick="window._oavAvanzarSiguiente('${seccionId}','${siguienteSeccion}')">
        📖 Avanzar al siguiente cuestionario
      </button>` : '';

    wrapper.innerHTML = `
      <div class="oav-result-screen">
        <div class="oav-result-icon">${icon}</div>
        <div class="oav-result-score">${totalScore}<span style="font-size:1.2rem;color:#94a3b8;font-weight:500"> / ${total}</span></div>
        <div class="oav-result-label">${Math.round(pct)}% de respuestas correctas</div>
        <div class="oav-result-bar-wrap">
          <div class="oav-result-bar-fill" style="width:0%;background:${barColor}" id="oav-result-bar-${seccionId}"></div>
        </div>
        <div class="oav-result-phrase">${frase}</div>
        <div class="oav-result-actions" style="flex-direction:column;align-items:center;gap:10px;">
          <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
            <button class="oav-btn oav-btn-ghost" onclick="window._oavReiniciar('${seccionId}')">🔄 Reiniciar este cuestionario</button>
            <button class="oav-btn oav-btn-ghost" onclick="window._oavRevisar('${seccionId}')">🔍 Revisar respuestas</button>
          </div>
          ${btnSiguiente}
          <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
            <button class="oav-btn oav-btn-ghost" onclick="window._oavVolverAlMenu('${seccionId}')">🏠 Salir al menú principal</button>
            ${seccionId === 'simulacro_iar'
              ? `<button class="oav-btn oav-btn-ghost" onclick="window.crearNuevoSimulacroIAR()">🎲 Crear nuevo cuestionario IAR</button>`
              : `<button class="oav-btn oav-btn-ghost" onclick="window._oavVolverAlSubmenu('${seccionId}')">📋 Volver al submenú IAR</button>`
            }
          </div>
        </div>
      </div>`;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const bar = document.getElementById('oav-result-bar-' + seccionId);
        if (bar) bar.style.width = pct + '%';
      });
    });
    wrapper.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function _localFrase(pct) {
    function pick(arr) {
      return arr[Math.floor(Math.random() * arr.length)];
    }

    if (pct === 100) return pick([
      '🏆 ¡Perfecto! Dominás cada concepto con maestría. Sos exactamente el médico que el sistema necesita.',
      '✨ Impecable. Tu conocimiento brilla con luz propia. Seguí así 💪',
      '🎯 Precisión absoluta. Cada respuesta refleja el fruto de tu dedicación.',
      '🏅 Excelencia en su máxima expresión. Este resultado es el reflejo de tu esfuerzo.'
    ]);
    if (pct >= 91) return pick([
      '🌟 ¡Excelente resultado! Estás muy cerca de la cima. Un pequeño ajuste más y alcanzarás la perfección.',
      '⭐ Casi perfecto. ¡Seguí afinando!',
      '🌠 Resultado sobresaliente. Vas por el camino exacto hacia la maestría.',
      '💎 Un desempeño brillante. Revisá los mínimos errores y la próxima será perfecta.'
    ]);
    if (pct >= 81) return pick([
      '💪 ¡Muy bien! Tu preparación es sólida. Revisá los errores con calma y vas a llegar más alto todavía.',
      '📚 Muy sólido. Tu base de conocimientos es envidiable.',
      '🌳 Tus cimientos son fuertes. Cada árbol grande comenzó siendo una semilla bien nutrida.',
      '🎓 Notable. La consistencia en tu estudio está dando frutos. ¡Celebrá este logro!'
    ]);
    if (pct >= 71) return pick([
      '📈 ¡Buen trabajo! Tenés una base firme. Con constancia y repaso vas a seguir creciendo rápidamente.',
      '📈 Progreso constante. Estás construyendo un conocimiento sólido, ladrillo tras ladrillo.',
      '🔬 Buen rendimiento. La ciencia médica se domina con práctica y paciencia.',
      '🌿 Crecimiento evidente. Cada acierto es una hoja nueva en el árbol de tu aprendizaje.'
    ]);
    if (pct >= 61) return pick([
      '🔍 Vas por buen camino. Cada error es una oportunidad de aprendizaje. ¡Seguí adelante con determinación!',
      '🩺 Aprendizaje en movimiento. Cada error te acerca más a la excelencia.',
      '📖 Estás en la zona de crecimiento. Los mejores médicos también tuvieron preguntas que responder.',
      '⚕️ Cada desafío superado te prepara para el próximo. Seguí con esa determinación.'
    ]);
    if (pct >= 51) return pick([
      '🌱 Estás en la mitad del camino. La medicina se aprende paso a paso. ¡Tu esfuerzo de hoy es tu éxito de mañana!',
      '🧠 La mitad del camino ya está recorrida. El conocimiento se construye con cada paso.',
      '🌱 Tu esfuerzo está rindiendo frutos. Seguí cultivando tu saber, la cosecha llegará.',
      '📚 Vas encontrando tu ritmo. La medicina se aprende como se construye un hogar: ladrillo a ladrillo.'
    ]);
    if (pct >= 41) return pick([
      '🔥 No te rindas. Los mejores médicos también tuvieron momentos difíciles. Cada intento te hace más fuerte.',
      '🕯️ No hay médico que no haya atravesado momentos de duda. Este resultado es parte de tu proceso.',
      '💪 La fortaleza no es no caer, sino levantarse con más conocimiento que antes.',
      '🌄 Cada amanecer trae una nueva oportunidad para aprender. Seguí adelante.'
    ]);
    if (pct >= 31) return pick([
      '💡 Este resultado te muestra exactamente dónde enfocar tu energía. ¡Esa claridad es un regalo valioso!',
      '🔎 Claridad. Ahora sabés exactamente dónde enfocar tu energía. Eso es un paso adelante.',
      '🎯 Cada respuesta que no acertaste te regaló una pista valiosa. Aprovechala.',
      '🪴 Este es el terreno fértil donde germinará tu dominio. Seguí regando tu estudio.'
    ]);
    if (pct >= 21) return pick([
      '❤️ El comienzo siempre es el más duro. Lo importante no es dónde empezás, sino la decisión de seguir intentándolo.',
      '❤️‍🩹 Los inicios siempre son desafiantes. Lo valioso no es dónde empezás, sino hacia dónde te dirigís.',
      '🌱 Las raíces más profundas pertenecen a los árboles que crecieron con paciencia. Tu momento está por llegar.'
    ]);
    return pick([
      '🌅 Cada experto fue alguna vez un principiante. Hoy es solo el inicio de tu transformación. ¡Volvé a intentarlo con confianza!',
      '🌅 La excelencia no es un destino, es un camino. Hoy diste el primer paso. Mañana darás otro.',
      '🕊️ No hay fracaso, solo información. Este resultado te dice con claridad por dónde empezar a construir.',
      '🎨 Cada gran obra comienza con un boceto. Tu versión final de experto está en proceso.'
    ]);
  }

  /* ─────────────────────────────────────────────────────────
     INTEGRACIÓN CON script.js
  ───────────────────────────────────────────────────────── */
  window._oavRenderOAV = renderOAV;
  window._oavState     = oavState;

  window._oavVolverAlMenu = function(seccionId) {
    _clearSessionMarks(seccionId);
    try {
      const raw = localStorage.getItem('quiz_state_v3');
      const all = JSON.parse(raw || '{}');
      if (all[seccionId]) { delete all[seccionId]; localStorage.setItem('quiz_state_v3', JSON.stringify(all)); }
    } catch(e) {}
    if (window.puntajesPorSeccion && window.puntajesPorSeccion[seccionId]) {
      const len = (window.preguntasPorSeccion && window.preguntasPorSeccion[seccionId] || []).length;
      window.puntajesPorSeccion[seccionId] = Array(len).fill(null);
    }
    if (typeof window.volverAlMenu === 'function') {
      window.volverAlMenu();
    } else if (typeof window.showMenu === 'function') {
      window.showMenu();
    }
  };

  window._oavVolverAlSubmenu = function(seccionId) {
    _clearSessionMarks(seccionId);
    try {
      const raw = localStorage.getItem('quiz_state_v3');
      const all = JSON.parse(raw || '{}');
      if (all[seccionId]) { delete all[seccionId]; localStorage.setItem('quiz_state_v3', JSON.stringify(all)); }
    } catch(e) {}
    if (window.puntajesPorSeccion && window.puntajesPorSeccion[seccionId]) {
      const len = (window.preguntasPorSeccion && window.preguntasPorSeccion[seccionId] || []).length;
      window.puntajesPorSeccion[seccionId] = Array(len).fill(null);
    }
    const submenuId = seccionId.startsWith('iar') ? 'iar-submenu' : 'submenu';
    if (typeof window.volverAlSubmenu === 'function') {
      window.volverAlSubmenu(submenuId);
    } else {
      if (typeof window.volverAlMenu === 'function') window.volverAlMenu();
    }
  };

  window._oavAvanzarSiguiente = function(seccionActual, seccionSiguiente) {
    _clearSessionMarks(seccionActual);
    try {
      const raw = localStorage.getItem('quiz_state_v3');
      const all = JSON.parse(raw || '{}');
      if (all[seccionActual]) { delete all[seccionActual]; localStorage.setItem('quiz_state_v3', JSON.stringify(all)); }
    } catch(e) {}
    if (window.puntajesPorSeccion && window.puntajesPorSeccion[seccionActual]) {
      const len = (window.preguntasPorSeccion && window.preguntasPorSeccion[seccionActual] || []).length;
      window.puntajesPorSeccion[seccionActual] = Array(len).fill(null);
    }
    if (typeof window.mostrarCuestionario === 'function') {
      window.mostrarCuestionario(seccionSiguiente);
    }
  };

  function _resaltarTextoBuscadoOAV(container, query) {
    if (!query || query.length < 2) return;
    var queryLower = query.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    var nodos = [];
    var node;
    while ((node = walker.nextNode())) nodos.push(node);
    nodos.forEach(function(textNode) {
      var text = textNode.textContent;
      var textNorm = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      var idx = textNorm.indexOf(queryLower);
      if (idx === -1) return;
      var frag = document.createDocumentFragment();
      var lastIdx = 0;
      while (idx !== -1) {
        frag.appendChild(document.createTextNode(text.substring(lastIdx, idx)));
        var mark = document.createElement('mark');
        mark.className = 'buscador-texto-highlight';
        mark.textContent = text.substring(idx, idx + queryLower.length);
        frag.appendChild(mark);
        lastIdx = idx + queryLower.length;
        idx = textNorm.indexOf(queryLower, lastIdx);
      }
      frag.appendChild(document.createTextNode(text.substring(lastIdx)));
      textNode.parentNode.replaceChild(frag, textNode);
    });
  }

  console.log('[OAV] ✅ Modo una-pregunta-por-vez listo.');

  /* ================================================================
     SISTEMA DE COMENTARIOS POR PREGUNTA — v2 CON MODERACIÓN MEJORADA
  ================================================================ */

  (function _inyectarEstilosComentarios() {
    const STYLE_ID = 'iar-comentarios-styles';
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = `
      .iar-comentarios {
        margin-top: 18px;
        border-top: 2px solid #2563eb22;
        padding-top: 14px;
        font-family: 'DM Sans', system-ui, sans-serif;
      }
      .iar-com-titulo {
        display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
        font-size: 0.8rem; font-weight: 700; color: #1e293b;
        margin-bottom: 10px; letter-spacing: 0.03em; text-transform: uppercase;
      }
      .iar-com-titulo .badge {
        background: #2563eb; color: #fff; border-radius: 100px;
        padding: 1px 8px; font-size: 0.7rem; font-weight: 700;
        letter-spacing: 0; text-transform: none;
      }
      .iar-admin-toolbar {
        display: flex; flex-wrap: wrap; gap: 6px; align-items: center;
        background: #eff6ff; border: 1px solid #bfdbfe;
        border-radius: 10px; padding: 8px 11px; margin-bottom: 10px;
        font-size: 0.72rem;
      }
      .iar-admin-toolbar-label {
        font-weight: 700; color: #1d4ed8; font-size: 0.68rem;
        text-transform: uppercase; letter-spacing: 0.04em; margin-right: 2px;
        white-space: nowrap;
      }
      .iar-admin-btn {
        display: inline-flex; align-items: center; gap: 4px;
        border: none; border-radius: 7px; padding: 4px 10px;
        font-size: 0.72rem; font-weight: 700; cursor: pointer;
        font-family: 'DM Sans', system-ui, sans-serif;
        transition: background .15s, transform .1s, opacity .15s;
        white-space: nowrap;
      }
      .iar-admin-btn:hover { transform: translateY(-1px); opacity: .88; }
      .iar-admin-btn:active { transform: none; opacity: 1; }
      .iar-admin-btn.borrar-todos  { background: #fee2e2; color: #dc2626; }
      .iar-admin-btn.pausar-preg   { background: #fef9c3; color: #92400e; }
      .iar-admin-btn.pausar-cuest  { background: #fde68a; color: #78350f; }
      .iar-admin-btn.pausar-global { background: #fca5a5; color: #7f1d1d; }
      .iar-admin-btn.activo        { outline: 2px solid currentColor; }
      .iar-com-lista {
        display: flex; flex-direction: column; gap: 8px;
        margin-bottom: 10px; max-height: 300px; overflow-y: auto; padding-right: 3px;
      }
      .iar-com-lista::-webkit-scrollbar { width: 4px; }
      .iar-com-lista::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
      .iar-com-item {
        background: #f8fafc; border: 1px solid #e2e8f0;
        border-radius: 10px; padding: 9px 12px; position: relative;
        padding-right: 34px;
      }
      .iar-com-item.es-admin { background: #eff6ff; border-color: #bfdbfe; }
      .iar-com-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 3px; }
      .iar-com-autor { font-weight: 700; font-size: 0.78rem; color: #1e293b; }
      .iar-com-autor.admin-tag::after {
        content: ' 👨‍⚕️ Admin'; background: #2563eb; color: #fff;
        border-radius: 100px; padding: 1px 7px; font-size: 0.63rem;
        font-weight: 700; margin-left: 4px;
      }
      .iar-com-fecha { font-size: 0.67rem; color: #94a3b8; }
      .iar-com-texto { font-size: 0.84rem; color: #334155; line-height: 1.55; word-break: break-word; }
      .iar-com-del {
        position: absolute; top: 7px; right: 8px;
        background: none; border: none; cursor: pointer;
        color: #cbd5e1; font-size: 0.9rem; padding: 2px 5px;
        border-radius: 5px; transition: color .15s, background .15s; line-height: 1;
      }
      .iar-com-del:hover { color: #dc2626; background: #fee2e2; }
      .iar-skeleton { display: flex; flex-direction: column; gap: 7px; margin-bottom: 8px; }
      .iar-skeleton-item {
        background: linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%);
        background-size: 200% 100%; animation: iar-shimmer 1.4s infinite;
        border-radius: 10px; height: 52px;
      }
      .iar-skeleton-item.short { height: 36px; }
      @keyframes iar-shimmer {
        0%   { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
      .iar-com-vacio { text-align: center; color: #94a3b8; font-size: 0.79rem; padding: 8px 0 4px; font-style: italic; }
      .iar-com-pausado {
        background: #fef3c7; border: 1px solid #fde68a; border-radius: 10px;
        padding: 10px 14px; font-size: 0.8rem; color: #92400e;
        display: flex; align-items: center; gap: 7px; margin-top: 6px;
      }
      .iar-com-form { display: flex; flex-direction: column; gap: 7px; margin-top: 4px; }
      .iar-com-ta {
        width: 100%; min-height: 66px; max-height: 130px;
        border: 1.5px solid #e2e8f0; border-radius: 10px;
        padding: 9px 12px; font-family: 'DM Sans', system-ui, sans-serif;
        font-size: 0.85rem; color: #1e293b; resize: vertical; outline: none;
        transition: border-color .15s; background: #fff; box-sizing: border-box;
      }
      .iar-com-ta:focus { border-color: #2563eb; box-shadow: 0 0 0 3px #2563eb18; }
      .iar-com-footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
      .iar-com-cc { font-size: 0.69rem; color: #94a3b8; }
      .iar-com-cc.cerca  { color: #d97706; font-weight: 600; }
      .iar-com-cc.maximo { color: #dc2626; font-weight: 700; }
      .iar-com-btn {
        background: #2563eb; color: #fff; border: none; border-radius: 8px;
        padding: 7px 17px; font-size: 0.81rem; font-weight: 700; cursor: pointer;
        transition: background .15s, transform .1s; font-family: 'DM Sans', system-ui, sans-serif;
        display: flex; align-items: center; gap: 5px;
      }
      .iar-com-btn:hover:not(:disabled) { background: #1d4ed8; transform: translateY(-1px); }
      .iar-com-btn:disabled { background: #93c5fd; cursor: not-allowed; transform: none; }
      .iar-com-err {
        background: #fee2e2; color: #dc2626; border: 1px solid #fecaca;
        border-radius: 8px; padding: 7px 11px; font-size: 0.79rem; display: none;
      }
      .iar-com-ok {
        background: #d1fae5; color: #059669; border: 1px solid #a7f3d0;
        border-radius: 8px; padding: 7px 11px; font-size: 0.79rem; display: none;
      }
      .iar-com-demo {
        background: #fef3c7; border: 1px solid #fde68a; border-radius: 8px;
        padding: 8px 12px; font-size: 0.77rem; color: #92400e;
        display: flex; align-items: center; gap: 6px; margin-top: 4px;
      }
      @media (max-width: 500px) {
        .iar-com-lista { max-height: 200px; }
        .iar-com-btn { padding: 6px 12px; font-size: 0.77rem; }
        .iar-admin-btn { padding: 4px 7px; font-size: 0.68rem; }
      }
    `;
    document.head.appendChild(s);
  })();

  // ============================================================
  // FUNCIÓN DE NORMALIZACIÓN MEJORADA (LEET SPEAK + SÍMBOLOS)
  // ============================================================
  function _comNorm(t) {
    if (!t) return '';
    
    // Paso 1: minúsculas
    let result = t.toLowerCase();
    
    // Paso 2: reemplazar números y símbolos por letras (leet speak)
    const leetMap = {
        '0': 'o', '1': 'i', '2': 'z', '3': 'e', '4': 'a',
        '5': 's', '6': 'b', '7': 't', '8': 'b', '9': 'g',
        '@': 'a', '$': 's', '+': 't', '&': 'y',
        '#': 'h', '%': 'o', '^': 'v',
        // Puntuación y separadores → espacio (no confundir con leet)
        '!': ' ', '?': ' ', '.': ' ', ',': ' ', ';': ' ', ':': ' ',
        '*': ' ', '-': ' ', '_': ' ', '=': ' ', '<': ' ', '>': ' ',
        '/': ' ', '\\': ' ', '|': ' ', '(': ' ', ')': ' ',
        '[': ' ', ']': ' ', '{': ' ', '}': ' '
    };
    result = result.split('').map(c => leetMap[c] !== undefined ? leetMap[c] : c).join('');
    
    // Paso 3: eliminar tildes
    result = result.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    
    // Paso 4: eliminar caracteres especiales restantes
    result = result.replace(/[^a-z\s]/g, ' ');
    
    // Paso 5: colapsar letras repetidas (ej: "culooo" → "culo", "boluuddo" → "boludo")
    result = result.replace(/(.)\1{2,}/g, '$1$1');
    
    // Paso 6: espacios múltiples a uno solo y trim
    result = result.replace(/\s+/g, ' ').trim();
    
    return result;
  }

  // ============================================================
  // LISTA DE PALABRAS PROHIBIDAS (SOLO BASE, SIN VARIANTES)
  // ============================================================
  const _COM_PROHIBIDAS = [
    // INSULTOS DIRECTOS
    'pelotudo', 'boludo', 'forro', 'hijodeputa', 'puta', 'puto',
    'choto', 'zorra', 'gil', 'tarado', 'mogolico', 'trolo',
    'marica', 'maricon', 'sorete', 'cagon', 'mierda', 'lacra',
    'escoria', 'basura', 'rata', 'chancho', 'cerdo', 'perro', 'buitre', 'alimaña',
    
    // PARTES DEL CUERPO (en contexto ofensivo - NO MÉDICO)
    'culo', 'culito', 'culos','orto', 'concha', 'verga', 'pija', 'pito', 'pichula', 'teta', 'nalga',
    
    // COMBINACIONES OFENSIVAS
    'hijodeputa', 'hijaputa', 'hijueputa', 'conchadesumadre', 'conchatumadre', 'putamadre', 'reputamadre', 'reconcha',
    'chupapija', 'chupapito', 'chupala','rompebolas', 'rompepelotas', 'soplapija', 'comepija', 'comemierda',
    'cagartepalos', 'cagarapalos',
    
    // INSULTOS RACISTAS / XENOFÓBICOS
    'sudaca', 'sudaka', 'bolita', 'paragua', 'boliguayo',     'chilote', 'brasuca', 'negrodemierda', 'negrada',
    
    // DISCAPACIDAD COMO INSULTO
    'mongolico', 'retrasado', 'retardado', 'discapacitado', 'tonto', 'lelo', 'autista',
    
    // INSULTOS POR ORIENTACIÓN SEXUAL
    'puto', 'maricon', 'maricón','trolo', 'travesti', 'tortillera', 'bollera',
    
    // INSULTOS POR CONDICIÓN SOCIAL
    'villero', 'planero', 'choriplanero', 'grasa', 'croto',
    
    // SPAM / URLs
    'http', 'https', 'www', 'clickaqui', 'clickaca', 'ganadinero', 'ganaplata','whatsapp', 'telegram', 'discord', 'instagram', 'facebook', 'twitter',
    'tiktok', 'inversiones', 'trading', 'cripto', 'bitcoin', 'prestamo', 'credito',
    
    // OFENSAS VARIAS
    'inservible', 'inutil', 'inepto', 'fracasado', 'mamerto',
    'chupamedias', 'lamebotas', 'vendepatria', 'traidor', 'mentiroso',
    'estafador', 'chorro', 'ratero', 'vago', 'parasito', 'apestoso',
  ];

  // ============================================================
  // FRASES PROHIBIDAS COMPLETAS
  // ============================================================
  const _COM_FRASES_PROHIBIDAS = [
    'te voy a matar', 'te mato', 'te pego', 'te voy a cagar', 'cagar a palos',
    'anda a la mierda', 'andate a la mierda', 'la concha de tu madre',
    'la puta que te pario', 'la puta madre',     'hijo de puta', 'hija puta', 'hijue puta',
    'concha de su madre', 'concha tumadre', 'puta madre', 'reputa madre', 'chupa pija', 'chupa pito', 'rompe bolas', 'rompe pelotas',
    'sopla pija', 'come pija', 'cagarte a palos', 'cagar a palos',
  ];

  // ============================================================
  // FUNCIÓN DE MODERACIÓN MEJORADA
  // ============================================================
  function _comModerar(texto) {
    if (!texto || !texto.trim()) return 'El comentario no puede estar vacío.';
    const t = texto.trim();
    if (t.length < 5) return 'El comentario es demasiado corto (mínimo 5 caracteres).';
    if (t.length > 800) return 'El comentario es demasiado largo (máximo 800 caracteres).';
    
    // Normalizar el texto completo
    const norm = _comNorm(t);
    
    // Verificar cada palabra prohibida
    for (const palabra of _COM_PROHIBIDAS) {
        const pn = _comNorm(palabra);
        
        // Buscar como palabra completa (con límites de palabra)
        const reEscaped = pn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp('(?:^|\\s)' + reEscaped + '(?:\\s|$)', 'i');
        // También buscar sin límites para detectar variantes pegadas (culito, pijazo, etc.)
        const rePartial = new RegExp(reEscaped, 'i');
        if (re.test(norm) || rePartial.test(norm)) {
            return '⚠️ Tu comentario contiene lenguaje inapropiado o enlaces no permitidos. Revisalo antes de publicar.';
        }
    }
    
    // Verificar frases completas
    for (const frase of _COM_FRASES_PROHIBIDAS) {
        const fn = _comNorm(frase);
        if (norm.includes(fn)) {
            return '⚠️ Tu comentario contiene lenguaje inapropiado o enlaces no permitidos. Revisalo antes de publicar.';
        }
    }
    
    // Verificar spam de mayúsculas
    const soloLetras = t.replace(/[^a-zA-Z]/g, '');
    if (soloLetras.length > 10 && soloLetras.replace(/[^A-Z]/g, '').length / soloLetras.length > 0.7) {
        return '⚠️ Por favor evitá escribir todo en MAYÚSCULAS.';
    }
    
    return null;
  }

  function _comFecha(ts) {
    if (!ts) return '';
    const date = ts.toDate ? ts.toDate() : ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
    if (isNaN(date.getTime())) return '';
    const diff = Date.now() - date;
    const min = Math.floor(diff / 60000), hr = Math.floor(diff / 3600000), day = Math.floor(diff / 86400000);
    if (min < 1)  return 'Hace un momento';
    if (min < 60) return `Hace ${min} min`;
    if (hr  < 24) return `Hace ${hr} h`;
    if (day < 7)  return `Hace ${day} día${day !== 1 ? 's' : ''}`;
    return date.toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  }

  function _comSanitize(str) {
    if (typeof str !== 'string') return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
              .replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/\n/g,'<br>');
  }

  function _comGetUser() {
    const user   = window._authCurrentUser || null;
    const esDemo = window._demoCheckEnabled === true;
    const esAdmin = window._esAdmin === true;
    let nombre = 'Usuario';
    if (user) nombre = user.displayName || (user.email ? user.email.split('@')[0] : 'Usuario');
    return { user, esDemo, esAdmin, nombre, uid: user ? user.uid : null };
  }

  async function _comLeerPausa() {
    try {
      const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      const db = window._firestoreDB_comentarios;
      if (!db) return {};
      const snap = await getDoc(doc(db, 'config', 'comentarios_pausa'));
      return snap.exists() ? snap.data() : {};
    } catch(e) {
      console.warn('[IAR Comentarios] No se pudo leer config de pausa:', e);
      return {};
    }
  }

  async function _comEscribirPausa(campos) {
    const { doc, setDoc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const db = window._firestoreDB_comentarios;
    if (!db) throw new Error('sin db');
    const ref = doc(db, 'config', 'comentarios_pausa');
    let actual = {};
    try { const s = await getDoc(ref); if (s.exists()) actual = s.data(); } catch(e) {}
    const nuevo = Object.assign({}, actual);
    for (const [k, v] of Object.entries(campos)) {
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        nuevo[k] = Object.assign({}, actual[k] || {}, v);
      } else {
        nuevo[k] = v;
      }
    }
    await setDoc(ref, nuevo);
    return nuevo;
  }

  function _comEstaPausado(pausa, seccionId, clave) {
    if (!pausa) return false;
    if (pausa.global === true) return 'global';
    if (pausa.cuestionarios && pausa.cuestionarios[seccionId] === true) return 'cuestionario';
    if (pausa.preguntas && pausa.preguntas[clave] === true) return 'pregunta';
    return false;
  }

  async function _comRender(seccionId, preguntaIdx) {
    const wrapperId = 'oav-wrapper-' + seccionId;
    const wrapper = document.getElementById(wrapperId);
    if (!wrapper) return;

    const clave = seccionId + '_' + preguntaIdx;
    const containerId = 'iar-com-' + clave;

    let cont = document.getElementById(containerId);
    if (!cont) {
      cont = document.createElement('div');
      cont.id = containerId;
      wrapper.appendChild(cont);
    } else {
      cont.innerHTML = '';
    }

    const { esDemo, esAdmin, nombre, uid } = _comGetUser();
    if (!uid) return;

    const pausa = await _comLeerPausa();
    const motivoPausa = _comEstaPausado(pausa, seccionId, clave);

    cont.className = 'iar-comentarios';
    cont.innerHTML = `
      <div class="iar-com-titulo">
        💬 Comentarios de la comunidad
        <span class="badge" id="iar-badge-${clave}">…</span>
      </div>
      <div id="iar-admintb-${clave}"></div>
      <div class="iar-skeleton" id="iar-sk-${clave}">
        <div class="iar-skeleton-item"></div>
        <div class="iar-skeleton-item short"></div>
      </div>
      <div class="iar-com-lista" id="iar-lista-${clave}" style="display:none"></div>
      <div id="iar-formarea-${clave}"></div>
    `;

    if (esAdmin) {
      _comRenderAdminToolbar(cont, clave, seccionId, pausa, uid, nombre);
    }

    const formArea = cont.querySelector('#iar-formarea-' + clave);
    if (esDemo) {
      formArea.innerHTML = `
        <div class="iar-com-demo">
          🔒 Los comentarios están disponibles para usuarios con acceso completo.
        </div>`;
    } else if (motivoPausa) {
      const msgs = {
        global:       '⏸️ Los comentarios están temporalmente suspendidos en toda la plataforma.',
        cuestionario: '⏸️ Los comentarios están suspendidos en este cuestionario.',
        pregunta:     '⏸️ Los comentarios están suspendidos para esta pregunta.',
      };
      formArea.innerHTML = `<div class="iar-com-pausado">${msgs[motivoPausa] || msgs.global}</div>`;
    } else {
      formArea.innerHTML = `
        <div class="iar-com-form" id="iar-form-${clave}">
          <textarea class="iar-com-ta" id="iar-ta-${clave}"
            placeholder="Dejá tu comentario, duda o aporte sobre esta pregunta…"
            maxlength="800"></textarea>
          <div class="iar-com-err" id="iar-err-${clave}"></div>
          <div class="iar-com-ok"  id="iar-ok-${clave}">✅ Comentario publicado.</div>
          <div class="iar-com-footer">
            <span class="iar-com-cc" id="iar-cc-${clave}">0 / 800</span>
            <button class="iar-com-btn" id="iar-btn-${clave}">✉️ Publicar</button>
          </div>
        </div>`;

      const ta  = cont.querySelector('#iar-ta-'  + clave);
      const cc  = cont.querySelector('#iar-cc-'  + clave);
      const btn = cont.querySelector('#iar-btn-' + clave);

      ta.addEventListener('input', () => {
        const len = ta.value.length;
        cc.textContent = len + ' / 800';
        cc.className = 'iar-com-cc' + (len > 780 ? ' maximo' : len > 700 ? ' cerca' : '');
      });

      btn.addEventListener('click', () => _comEnviar(clave, seccionId, preguntaIdx, cont, uid, nombre, esAdmin));
    }

    await _comCargar(clave, cont, uid, esAdmin);
  }

  function _comRenderAdminToolbar(cont, clave, seccionId, pausa, uid, nombre) {
    const tbEl = cont.querySelector('#iar-admintb-' + clave);
    if (!tbEl) return;

    const pausaPreg   = !!(pausa.preguntas    && pausa.preguntas[clave]);
    const pausaCuest  = !!(pausa.cuestionarios && pausa.cuestionarios[seccionId]);
    const pausaGlobal = !!pausa.global;

    tbEl.innerHTML = `
      <div class="iar-admin-toolbar">
        <span class="iar-admin-toolbar-label">🔧 Admin</span>
        <button class="iar-admin-btn borrar-todos"  id="iar-adm-borrar-${clave}"  title="Borra todos los comentarios de esta pregunta">🗑️ Borrar todos</button>
        <button class="iar-admin-btn pausar-preg  ${pausaPreg   ? 'activo' : ''}" id="iar-adm-ppre-${clave}"   title="Pausar/reanudar comentarios de esta pregunta">${pausaPreg   ? '▶️ Reanudar pregunta'  : '⏸️ Pausar pregunta'}</button>
        <button class="iar-admin-btn pausar-cuest ${pausaCuest  ? 'activo' : ''}" id="iar-adm-pcue-${clave}"   title="Pausar/reanudar comentarios de todo el cuestionario">${pausaCuest  ? '▶️ Reanudar cuestionario' : '⏸️ Pausar cuestionario'}</button>
        <button class="iar-admin-btn pausar-global ${pausaGlobal ? 'activo' : ''}" id="iar-adm-pglo-${clave}"  title="Pausar/reanudar todos los comentarios de la plataforma">${pausaGlobal ? '▶️ Reanudar todo' : '⏸️ Pausar todo'}</button>
      </div>`;

    tbEl.querySelector('#iar-adm-borrar-' + clave).addEventListener('click', async () => {
      if (!confirm('¿Borrar TODOS los comentarios de esta pregunta? Esta acción no se puede deshacer.')) return;
      await _comBorrarTodos(clave, cont);
    });

    tbEl.querySelector('#iar-adm-ppre-' + clave).addEventListener('click', async () => {
      const nuevoVal = !pausaPreg;
      try {
        await _comEscribirPausa({ preguntas: { [clave]: nuevoVal } });
        const partes = clave.split('_');
        const idx = parseInt(partes[partes.length - 1]);
        const sid = partes.slice(0, partes.length - 1).join('_');
        await _comRender(sid, idx);
      } catch(e) { alert('No se pudo cambiar el estado. Intentá de nuevo.'); }
    });

    tbEl.querySelector('#iar-adm-pcue-' + clave).addEventListener('click', async () => {
      const nuevoVal = !pausaCuest;
      const accion = nuevoVal ? 'pausar' : 'reanudar';
      if (!confirm(`¿${accion.charAt(0).toUpperCase()+accion.slice(1)} los comentarios de TODO el cuestionario "${seccionId}"?`)) return;
      try {
        await _comEscribirPausa({ cuestionarios: { [seccionId]: nuevoVal } });
        const partes = clave.split('_');
        const idx = parseInt(partes[partes.length - 1]);
        const sid = partes.slice(0, partes.length - 1).join('_');
        await _comRender(sid, idx);
      } catch(e) { alert('No se pudo cambiar el estado. Intentá de nuevo.'); }
    });

    tbEl.querySelector('#iar-adm-pglo-' + clave).addEventListener('click', async () => {
      const nuevoVal = !pausaGlobal;
      const accion = nuevoVal ? 'pausar' : 'reanudar';
      if (!confirm(`¿${accion.charAt(0).toUpperCase()+accion.slice(1)} los comentarios en TODA la plataforma?`)) return;
      try {
        await _comEscribirPausa({ global: nuevoVal });
        const partes = clave.split('_');
        const idx = parseInt(partes[partes.length - 1]);
        const sid = partes.slice(0, partes.length - 1).join('_');
        await _comRender(sid, idx);
      } catch(e) { alert('No se pudo cambiar el estado. Intentá de nuevo.'); }
    });
  }

  async function _comBorrarTodos(clave, cont) {
    try {
      const { collection, getDocs, doc, deleteDoc, writeBatch } =
        await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      const db = window._firestoreDB_comentarios;
      if (!db) throw new Error('sin db');
      const snap = await getDocs(collection(db, 'comentarios', clave, 'mensajes'));
      if (snap.empty) {
        alert('No hay comentarios para borrar en esta pregunta.');
        return;
      }
      const batch = writeBatch(db);
      snap.forEach(d => batch.delete(doc(db, 'comentarios', clave, 'mensajes', d.id)));
      await batch.commit();
      const lista = cont.querySelector('#iar-lista-' + clave);
      const badge = cont.querySelector('#iar-badge-' + clave);
      if (lista) lista.innerHTML = '<div class="iar-com-vacio">Todavía no hay comentarios. ¡Sé el primero!</div>';
      if (badge) badge.textContent = '0';
    } catch(e) {
      console.warn('[IAR Comentarios] Error al borrar todos:', e);
      alert('No se pudieron borrar los comentarios. Intentá de nuevo.');
    }
  }

  async function _comCargar(clave, cont, uid, esAdmin) {
    const sk    = cont.querySelector('#iar-sk-'    + clave);
    const lista = cont.querySelector('#iar-lista-' + clave);
    const badge = cont.querySelector('#iar-badge-' + clave);

    try {
      const { collection, query, orderBy, limit, getDocs } =
        await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

      const db = window._firestoreDB_comentarios;
      if (!db) throw new Error('sin db');

      const q = query(
        collection(db, 'comentarios', clave, 'mensajes'),
        orderBy('timestamp', 'asc'),
        limit(50)
      );
      const snap = await getDocs(q);

      if (sk)    sk.style.display    = 'none';
      if (lista) lista.style.display = 'flex';

      const docs = [];
      snap.forEach(d => docs.push({ id: d.id, ...d.data() }));

      if (badge) badge.textContent = docs.length;

      if (!docs.length) {
        lista.innerHTML = '<div class="iar-com-vacio">Todavía no hay comentarios. ¡Sé el primero!</div>';
        return;
      }

      lista.innerHTML = '';
      docs.forEach(c => lista.appendChild(_comItemDOM(c, clave, uid, esAdmin)));
      lista.scrollTop = lista.scrollHeight;

    } catch (e) {
      console.warn('[IAR Comentarios] Error al cargar:', e);
      if (sk)    sk.style.display    = 'none';
      if (lista) {
        lista.style.display = 'flex';
        lista.innerHTML = '<div class="iar-com-vacio">⚠️ No se pudieron cargar los comentarios.</div>';
      }
    }
  }

  function _comItemDOM(c, clave, uid, esAdmin) {
    const ADMIN_EMAIL = 'admin.14r@gmail.com';
    const esAutorAdmin = c.email === ADMIN_EMAIL;
    const esPropioComentario = c.uid === uid;
    const puedeEliminar = esAdmin || esPropioComentario;

    const div = document.createElement('div');
    div.className = 'iar-com-item' + (esAutorAdmin ? ' es-admin' : '');
    div.dataset.id = c.id;
    div.innerHTML = `
      <div class="iar-com-meta">
        <span class="iar-com-autor ${esAutorAdmin ? 'admin-tag' : ''}">${_comSanitize(c.nombre || 'Usuario')}</span>
        <span class="iar-com-fecha">${_comFecha(c.timestamp)}</span>
      </div>
      <div class="iar-com-texto">${_comSanitize(c.texto)}</div>
      ${puedeEliminar ? '<button class="iar-com-del" title="Eliminar comentario">🗑️</button>' : ''}
    `;
    if (puedeEliminar) {
      div.querySelector('.iar-com-del').addEventListener('click', () => _comEliminar(c.id, clave, div));
    }
    return div;
  }

  async function _comEnviar(clave, seccionId, preguntaIdx, cont, uid, nombre, esAdmin) {
    const ta  = cont.querySelector('#iar-ta-'  + clave);
    const err = cont.querySelector('#iar-err-' + clave);
    const ok  = cont.querySelector('#iar-ok-'  + clave);
    const btn = cont.querySelector('#iar-btn-' + clave);
    if (!ta || !err || !ok || !btn) return;

    const texto = ta.value.trim();
    err.style.display = 'none';
    ok.style.display  = 'none';

    // APLICAR MODERACIÓN (incluso para admin, pero admin puede saltarla si se desea)
    // En este código, el admin también está sujeto a moderación.
    const errorMod = _comModerar(texto);
    if (errorMod) {
      err.textContent = errorMod;
      err.style.display = 'block';
      ta.focus();
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '⏳ Publicando…';

    try {
      const { collection, addDoc, serverTimestamp } =
        await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');

      const db   = window._firestoreDB_comentarios;
      const user = window._authCurrentUser;
      if (!db) throw new Error('sin db');

      await addDoc(collection(db, 'comentarios', clave, 'mensajes'), {
        uid,
        nombre,
        email: (user && user.email) || '',
        texto,
        timestamp: serverTimestamp(),
        seccionId,
        preguntaIdx,
      });

      ta.value = '';
      const cc = cont.querySelector('#iar-cc-' + clave);
      if (cc) { cc.textContent = '0 / 800'; cc.className = 'iar-com-cc'; }

      ok.style.display = 'block';
      setTimeout(() => { ok.style.display = 'none'; }, 3500);

      await _comCargar(clave, cont, uid, esAdmin);

    } catch (e) {
      console.warn('[IAR Comentarios] Error al enviar:', e);
      err.textContent = '⚠️ No se pudo publicar. Verificá tu conexión e intentá de nuevo.';
      err.style.display = 'block';
    } finally {
      btn.disabled = false;
      btn.innerHTML = '✉️ Publicar';
    }
  }

  async function _comEliminar(docId, clave, divEl) {
    if (!confirm('¿Eliminar este comentario?')) return;
    divEl.style.opacity = '0.4';
    divEl.style.pointerEvents = 'none';
    try {
      const { doc, deleteDoc } =
        await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
      const db = window._firestoreDB_comentarios;
      if (!db) throw new Error('sin db');
      await deleteDoc(doc(db, 'comentarios', clave, 'mensajes', docId));
      divEl.remove();
      const cont = divEl.closest ? divEl.closest('.iar-comentarios') : null;
      if (cont) {
        const lista = cont.querySelector('[id^="iar-lista-"]');
        const badge = cont.querySelector('[id^="iar-badge-"]');
        if (lista && badge) {
          const n = lista.querySelectorAll('.iar-com-item').length;
          badge.textContent = n;
          if (n === 0) lista.innerHTML = '<div class="iar-com-vacio">Todavía no hay comentarios. ¡Sé el primero!</div>';
        }
      }
    } catch (e) {
      console.warn('[IAR Comentarios] Error al eliminar:', e);
      divEl.style.opacity = '1';
      divEl.style.pointerEvents = '';
      alert('No se pudo eliminar el comentario. Intentá de nuevo.');
    }
  }

  window._oavRenderComentarios = _comRender;

  console.log('[IAR Comentarios] ✅ Sistema de comentarios v2 con moderación mejorada listo.');

})();
