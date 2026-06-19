/* ============================================================
   comentarios.js — Caja de comentarios con hilos para cada examen
   ============================================================
   Requiere que firebase-auth.js ya haya expuesto (lo hace en
   mostrarBarraSesion, línea ~1741):
     window._firestoreDB_comentarios  -> instancia Firestore (db)
     window._authCurrentUser          -> auth.currentUser
     window._esAdmin                  -> bool

   Cómo usarlo: llamar
     window.IARComentarios.render(seccionId, resultNode)
   pasando como `resultNode` el div de resultado final del examen
   (el mismo `resultado-total-${seccionId}` que ya usás). La caja
   se inserta justo DESPUÉS de ese nodo.

   Estructura en Firestore (coherente con tus reglas actuales):
     comentarios/{seccionId}/mensajes/{mensajeId}
       { uid, nombre, texto, ts, parentId }   // parentId null = raíz
     notificaciones_admin/{notifId}
       { mensajeId, seccionId, parentId, uid, nombre, texto, ts, leido }
   ============================================================ */
(function () {
  let _fsModule = null;

  async function _fs() {
    if (_fsModule) return _fsModule;
    _fsModule = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    return _fsModule;
  }

  function _escapeHTML(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function _fechaCorta(ts) {
    try {
      const d = ts && ts.toDate ? ts.toDate() : new Date();
      return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
        ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  }

  function _inyectarEstilos() {
    if (document.getElementById('comentarios-styles')) return;
    const s = document.createElement('style');
    s.id = 'comentarios-styles';
    s.textContent = `
      .com-box-wrapper { width:100%; }
      .com-box { margin-top:28px; border-top:2px solid #e2e8f0; padding-top:18px; }
      .com-titulo { font-size:1.05rem; font-weight:700; color:#1e293b; margin-bottom:10px; }
      .com-form { display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap; }
      .com-form textarea {
        flex:1; min-width:220px; border:1.5px solid #cbd5e1; border-radius:8px;
        padding:8px 10px; font-size:.9rem; resize:vertical; min-height:42px; font-family:inherit;
      }
      .com-form button {
        background:#1e40af; color:#fff; border:none; border-radius:8px;
        padding:8px 16px; font-size:.85rem; font-weight:600; cursor:pointer; align-self:flex-start;
      }
      .com-form button:disabled { opacity:.5; cursor:not-allowed; }
      .com-msg-error { color:#dc2626; font-size:.78rem; margin:2px 0 12px; }
      .com-item { background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px 14px; margin-bottom:10px; }
      .com-item-head { display:flex; justify-content:space-between; align-items:baseline; gap:8px; flex-wrap:wrap; }
      .com-item-nombre { font-weight:700; font-size:.85rem; color:#1e3a8a; }
      .com-item-fecha { font-size:.72rem; color:#94a3b8; }
      .com-item-texto { font-size:.88rem; color:#1e293b; margin-top:4px; white-space:pre-wrap; word-break:break-word; }
      .com-item-acciones { margin-top:6px; display:flex; gap:14px; }
      .com-item-acciones button { background:none; border:none; color:#64748b; font-size:.75rem; cursor:pointer; padding:0; }
      .com-item-acciones button.com-btn-borrar { color:#dc2626; }
      .com-respuestas { margin-left:22px; margin-top:8px; border-left:2px solid #dbeafe; padding-left:12px; }
      .com-reply-form { display:none; margin-top:8px; gap:6px; }
      .com-reply-form.activo { display:flex; }
      .com-reply-form textarea { flex:1; font-size:.85rem; padding:6px 8px; border-radius:6px; border:1px solid #cbd5e1; min-height:34px; font-family:inherit; }
      .com-reply-form button { font-size:.78rem; padding:5px 10px; border-radius:6px; background:#1e40af; color:#fff; border:none; cursor:pointer; align-self:flex-start; }
      .com-vacio { font-size:.85rem; color:#94a3b8; font-style:italic; }
      .com-highlight { animation: comFlash 1.6s ease; }
      @keyframes comFlash { 0%,100% { background:#f8fafc; } 30% { background:#fef9c3; } }
    `;
    document.head.appendChild(s);
  }

  // ── Crear comentario o respuesta + notificación para el admin ──
  async function _crearComentario(seccionId, texto, parentId) {
    const db = window._firestoreDB_comentarios;
    const user = window._authCurrentUser;
    if (!db || !user) throw new Error('Necesitás iniciar sesión para comentar.');
    const { collection, addDoc, serverTimestamp } = await _fs();

    const nombre = (user.email || 'Usuario').split('@')[0];
    const mensajesRef = collection(db, 'comentarios', seccionId, 'mensajes');
    const nuevoDoc = await addDoc(mensajesRef, {
      uid: user.uid,
      nombre,
      texto,
      ts: serverTimestamp(),
      parentId: parentId || null
    });

    try {
      const notifRef = collection(db, 'notificaciones_admin');
      await addDoc(notifRef, {
        mensajeId: nuevoDoc.id,
        seccionId,
        parentId: parentId || null,
        uid: user.uid,
        nombre,
        texto,
        ts: serverTimestamp(),
        leido: false
      });
    } catch (e) {
      console.warn('[Comentarios] No se pudo crear la notificación admin:', e.message);
    }

    return nuevoDoc.id;
  }

  async function _borrarComentario(seccionId, mensajeId) {
    const db = window._firestoreDB_comentarios;
    const { doc, deleteDoc } = await _fs();
    await deleteDoc(doc(db, 'comentarios', seccionId, 'mensajes', mensajeId));
  }

  async function _cargarMensajes(seccionId) {
    const db = window._firestoreDB_comentarios;
    const { collection, getDocs, query, orderBy } = await _fs();
    const q = query(collection(db, 'comentarios', seccionId, 'mensajes'), orderBy('ts', 'asc'));
    const snap = await getDocs(q);
    const todos = [];
    snap.forEach(d => todos.push({ id: d.id, ...d.data() }));
    const raices = todos.filter(m => !m.parentId);
    const porPadre = {};
    todos.forEach(m => { if (m.parentId) (porPadre[m.parentId] = porPadre[m.parentId] || []).push(m); });
    return { raices, porPadre };
  }

  function _renderComentario(m, porPadre, contUid, esAdmin) {
    const puedeBorrar = esAdmin || m.uid === contUid;
    return `
      <div class="com-item" id="com-${m.id}" data-mensaje-id="${m.id}">
        <div class="com-item-head">
          <span class="com-item-nombre">${_escapeHTML(m.nombre || 'Usuario')}</span>
          <span class="com-item-fecha">${_fechaCorta(m.ts)}</span>
        </div>
        <div class="com-item-texto">${_escapeHTML(m.texto)}</div>
        <div class="com-item-acciones">
          <button class="com-btn-responder" data-id="${m.id}">↩ Responder</button>
          ${puedeBorrar ? `<button class="com-btn-borrar" data-id="${m.id}">🗑 Eliminar</button>` : ''}
        </div>
        <div class="com-reply-form" id="reply-form-${m.id}">
          <textarea placeholder="Escribí tu respuesta..." maxlength="800"></textarea>
          <button class="com-btn-enviar-reply" data-parent="${m.id}">Responder</button>
        </div>
        <div class="com-respuestas" id="respuestas-${m.id}">
          ${(porPadre[m.id] || []).map(r => _renderComentario(r, porPadre, contUid, esAdmin)).join('')}
        </div>
      </div>`;
  }

  function _adjuntarEventos(lista, seccionId, anchorNode) {
    lista.querySelectorAll('.com-btn-responder').forEach(btn => {
      btn.addEventListener('click', () => {
        const form = lista.querySelector(`#reply-form-${btn.dataset.id}`);
        if (form) form.classList.toggle('activo');
      });
    });

    lista.querySelectorAll('.com-btn-enviar-reply').forEach(btn => {
      btn.addEventListener('click', async () => {
        const form = btn.closest('.com-reply-form');
        const textarea = form.querySelector('textarea');
        const texto = textarea.value.trim();
        if (texto.length < 3) { textarea.focus(); return; }
        btn.disabled = true;
        try {
          await _crearComentario(seccionId, texto, btn.dataset.parent);
          await renderCajaComentarios(seccionId, anchorNode);
        } catch (e) {
          alert(e.message || 'Error al enviar la respuesta.');
          btn.disabled = false;
        }
      });
    });

    lista.querySelectorAll('.com-btn-borrar').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar este comentario? No se puede deshacer.')) return;
        try {
          await _borrarComentario(seccionId, btn.dataset.id);
          await renderCajaComentarios(seccionId, anchorNode);
        } catch (e) {
          alert('No se pudo eliminar: ' + (e.message || ''));
        }
      });
    });
  }

  // ── Función pública: renderiza/refresca la caja completa de una sección ──
  async function renderCajaComentarios(seccionId, anchorNode) {
    if (!anchorNode) return;
    _inyectarEstilos();

    let wrapper = anchorNode.parentElement
      ? anchorNode.parentElement.querySelector(`.com-box-wrapper[data-seccion="${seccionId}"]`)
      : null;
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = 'com-box-wrapper';
      wrapper.dataset.seccion = seccionId;
      anchorNode.insertAdjacentElement('afterend', wrapper);
    }

    wrapper.innerHTML = `
      <div class="com-box">
        <div class="com-titulo">💬 Comentarios y correcciones de este examen</div>
        <div class="com-form">
          <textarea id="com-nuevo-${seccionId}" placeholder="¿Encontraste un error o tenés una sugerencia sobre este examen?" maxlength="800"></textarea>
          <button id="com-btn-enviar-${seccionId}">Comentar</button>
        </div>
        <div id="com-msg-error-${seccionId}" class="com-msg-error" style="display:none;"></div>
        <div id="com-lista-${seccionId}"><em class="com-vacio">Cargando comentarios...</em></div>
      </div>`;

    const lista = wrapper.querySelector(`#com-lista-${seccionId}`);
    const user = window._authCurrentUser;
    const esAdmin = !!window._esAdmin;

    try {
      const { raices, porPadre } = await _cargarMensajes(seccionId);
      lista.innerHTML = raices.length
        ? raices.map(m => _renderComentario(m, porPadre, user && user.uid, esAdmin)).join('')
        : '<em class="com-vacio">Todavía no hay comentarios en este examen. ¡Sé el primero!</em>';
      _adjuntarEventos(lista, seccionId, anchorNode);
    } catch (e) {
      lista.innerHTML = '<em style="color:#dc2626;">No se pudieron cargar los comentarios.</em>';
      console.warn('[Comentarios] Error al cargar:', e.message);
    }

    const btnEnviar = wrapper.querySelector(`#com-btn-enviar-${seccionId}`);
    const textarea = wrapper.querySelector(`#com-nuevo-${seccionId}`);
    const errorDiv = wrapper.querySelector(`#com-msg-error-${seccionId}`);

    btnEnviar.onclick = async () => {
      errorDiv.style.display = 'none';
      const texto = textarea.value.trim();
      if (!window._authCurrentUser) {
        errorDiv.textContent = 'Necesitás iniciar sesión para comentar.';
        errorDiv.style.display = 'block';
        return;
      }
      if (texto.length < 5) {
        errorDiv.textContent = 'El comentario debe tener al menos 5 caracteres.';
        errorDiv.style.display = 'block';
        return;
      }
      btnEnviar.disabled = true;
      try {
        await _crearComentario(seccionId, texto, null);
        textarea.value = '';
        await renderCajaComentarios(seccionId, anchorNode);
      } catch (e) {
        errorDiv.textContent = e.message || 'No se pudo publicar (¿tu licencia es demo? las demos solo pueden leer).';
        errorDiv.style.display = 'block';
      } finally {
        btnEnviar.disabled = false;
      }
    };
  }

  // ── Saltar a un comentario puntual desde la notificación del admin ──
  window.irAComentario = function (seccionId, mensajeId) {
    if (typeof window.mostrarCuestionario === 'function') {
      window.mostrarCuestionario(seccionId);
    }
    let intentos = 0;
    const esperar = setInterval(() => {
      intentos++;
      const el = document.getElementById(`com-${mensajeId}`);
      if (el) {
        clearInterval(esperar);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('com-highlight');
        setTimeout(() => el.classList.remove('com-highlight'), 1700);
      } else if (intentos > 25) {
        clearInterval(esperar);
      }
    }, 300);
  };

  window.IARComentarios = { render: renderCajaComentarios };
})();
