/* ============================================================
   v2 comentarios.js — Caja de comentarios con hilos para cada examen
   ============================================================
   Requiere que firebase-auth.js ya haya expuesto (en mostrarBarraSesion):
     window._firestoreDB_comentarios  -> instancia Firestore (db)
     window._authCurrentUser          -> auth.currentUser
     window._esAdmin                  -> bool

   Cómo usarlo: llamar
     window.IARComentarios.render(seccionId, anchorNode)
   pasando como `anchorNode` el elemento DESPUÉS del cual se debe
   insertar la caja (normalmente el contenedor de botones
   Reiniciar/Volver de cada página .pagina-cuestionario). La caja
   vive FUERA del contenedor de preguntas, así que no se destruye
   al responder/navegar entre preguntas — queda siempre visible,
   sin necesidad de terminar el examen.

   Cambios v2:
     - Usuarios DEMO no pueden escribir comentarios (aviso claro en frontend).
     - Filtro de lenguaje inapropiado vía window.IARFiltro (filtro_palabras.js).

   Estructura en Firestore (coherente con reglas_firestore_database_18):
     comentarios/{seccionId}/mensajes/{mensajeId}
       { uid, nombre, texto, ts, parentId, editado?, fechaEdicion? }
       // parentId null = comentario raíz, string = respuesta anidada
     notificaciones_admin/{notifId}
       { tipo:'comentario', mensajeId, seccionId, parentId, uid, nombre, texto, ts, leido }
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

  // ── Emojis frecuentes para el picker simple (sin librerías externas) ──
  const EMOJIS_PICKER = [
    '😀','😂','🙂','😉','😍','🤔','😅','😢','😡','👍',
    '👎','🙏','👏','💪','🔥','✅','❌','⚠️','💡','📌',
    '❤️','⭐','🎉','😮','🤝','🙌','😴','🤓','📚','🩺'
  ];

  function _inyectarEstilos() {
    if (document.getElementById('comentarios-styles')) return;
    const s = document.createElement('style');
    s.id = 'comentarios-styles';
    s.textContent = `
      .com-box-wrapper { width:100%; }
      .com-box { margin-top:28px; border-top:2px solid #e2e8f0; padding-top:18px; }
      .com-titulo { font-size:1.05rem; font-weight:700; color:#1e293b; margin-bottom:10px; }
      .com-form { display:flex; gap:8px; margin-bottom:8px; flex-wrap:wrap; position:relative; }
      .com-form-campo { flex:1; min-width:220px; display:flex; flex-direction:column; gap:6px; }
      .com-form textarea {
        width:100%; border:1.5px solid #cbd5e1; border-radius:8px;
        padding:8px 10px; font-size:.9rem; resize:vertical; min-height:42px; font-family:inherit;
        box-sizing:border-box;
      }
      .com-form-botones { display:flex; gap:6px; align-items:flex-start; }
      .com-form button.com-btn-enviar {
        background:#1e40af; color:#fff; border:none; border-radius:8px;
        padding:8px 16px; font-size:.85rem; font-weight:600; cursor:pointer;
      }
      .com-form button:disabled { opacity:.5; cursor:not-allowed; }
      .com-btn-emoji {
        background:#f1f5f9; border:1.5px solid #cbd5e1; border-radius:8px;
        font-size:1.05rem; padding:6px 10px; cursor:pointer; line-height:1;
      }
      .com-btn-emoji:hover { background:#e2e8f0; }
      .com-emoji-picker {
        position:absolute; top:100%; left:0; margin-top:4px; z-index:50;
        background:#fff; border:1.5px solid #cbd5e1; border-radius:10px;
        box-shadow:0 8px 20px rgba(0,0,0,.15); padding:8px;
        display:grid; grid-template-columns:repeat(10, 1fr); gap:2px;
        width:280px; max-width:90vw;
      }
      .com-emoji-picker.oculto { display:none; }
      .com-emoji-picker button {
        background:none; border:none; font-size:1.15rem; padding:4px;
        cursor:pointer; border-radius:6px; line-height:1;
      }
      .com-emoji-picker button:hover { background:#f1f5f9; }
      .com-msg-error { color:#dc2626; font-size:.78rem; margin:2px 0 12px; }
      .com-item { background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; padding:10px 14px; margin-bottom:10px; }
      .com-item-head { display:flex; justify-content:space-between; align-items:baseline; gap:8px; flex-wrap:wrap; }
      .com-item-nombre { font-weight:700; font-size:.85rem; color:#1e3a8a; }
      .com-item-fecha { font-size:.72rem; color:#94a3b8; }
      .com-item-editado { font-size:.7rem; color:#94a3b8; font-style:italic; margin-left:4px; }
      .com-item-texto { font-size:.88rem; color:#1e293b; margin-top:4px; white-space:pre-wrap; word-break:break-word; }
      .com-item-acciones { margin-top:6px; display:flex; gap:14px; flex-wrap:wrap; }
      .com-item-acciones button { background:none; border:none; color:#64748b; font-size:.75rem; cursor:pointer; padding:0; }
      .com-item-acciones button.com-btn-borrar { color:#dc2626; }
      .com-item-acciones button.com-btn-editar { color:#1e40af; }
      .com-respuestas { margin-left:22px; margin-top:8px; border-left:2px solid #dbeafe; padding-left:12px; }
      .com-reply-form { display:none; margin-top:8px; gap:6px; position:relative; }
      .com-reply-form.activo { display:flex; flex-wrap:wrap; }
      .com-reply-form textarea { flex:1; min-width:160px; font-size:.85rem; padding:6px 8px; border-radius:6px; border:1px solid #cbd5e1; min-height:34px; font-family:inherit; }
      .com-reply-form button.com-btn-enviar-reply { font-size:.78rem; padding:5px 10px; border-radius:6px; background:#1e40af; color:#fff; border:none; cursor:pointer; align-self:flex-start; }
      .com-edit-form { display:none; margin-top:8px; gap:6px; position:relative; }
      .com-edit-form.activo { display:flex; flex-wrap:wrap; }
      .com-edit-form textarea { flex:1; min-width:160px; font-size:.85rem; padding:6px 8px; border-radius:6px; border:1px solid #cbd5e1; min-height:34px; font-family:inherit; }
      .com-edit-form button { font-size:.78rem; padding:5px 10px; border-radius:6px; border:none; cursor:pointer; align-self:flex-start; }
      .com-edit-form .com-btn-guardar { background:#059669; color:#fff; }
      .com-edit-form .com-btn-cancelar { background:#e2e8f0; color:#334155; }
      .com-vacio { font-size:.85rem; color:#94a3b8; font-style:italic; }
      .com-highlight { animation: comFlash 1.6s ease; }
      @keyframes comFlash { 0%,100% { background:#f8fafc; } 30% { background:#fef9c3; } }
    `;
    document.head.appendChild(s);
  }

  // ── Picker de emojis: lo conecta a una textarea concreta ──
  function _armarEmojiPicker(textareaEl, pickerEl) {
    pickerEl.innerHTML = EMOJIS_PICKER.map(e => `<button type="button" data-emoji="${e}">${e}</button>`).join('');
    pickerEl.querySelectorAll('button').forEach(b => {
      b.addEventListener('click', () => {
        const inicio = textareaEl.selectionStart || textareaEl.value.length;
        const fin = textareaEl.selectionEnd || textareaEl.value.length;
        const valor = textareaEl.value;
        textareaEl.value = valor.slice(0, inicio) + b.dataset.emoji + valor.slice(fin);
        textareaEl.focus();
        const nuevaPos = inicio + b.dataset.emoji.length;
        textareaEl.setSelectionRange(nuevaPos, nuevaPos);
        pickerEl.classList.add('oculto');
      });
    });
  }

  function _togglePicker(pickerEl) {
    document.querySelectorAll('.com-emoji-picker').forEach(p => {
      if (p !== pickerEl) p.classList.add('oculto');
    });
    pickerEl.classList.toggle('oculto');
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
        tipo: 'comentario',
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

  async function _editarComentario(seccionId, mensajeId, nuevoTexto) {
    const db = window._firestoreDB_comentarios;
    const { doc, updateDoc, serverTimestamp } = await _fs();
    await updateDoc(doc(db, 'comentarios', seccionId, 'mensajes', mensajeId), {
      texto: nuevoTexto,
      editado: true,
      fechaEdicion: serverTimestamp()
    });
  }

  async function _borrarComentario(seccionId, mensajeId, datosParaAuditoria) {
    const db = window._firestoreDB_comentarios;
    const { doc, deleteDoc, collection, addDoc, serverTimestamp } = await _fs();
    await deleteDoc(doc(db, 'comentarios', seccionId, 'mensajes', mensajeId));

    // Registro de auditoría: solo cuando el admin borra un comentario AJENO
    // (si el propio usuario borra el suyo, no es un acto de moderación).
    const admin = window._authCurrentUser;
    if (window._esAdmin && datosParaAuditoria && datosParaAuditoria.uid !== (admin && admin.uid)) {
      try {
        await addDoc(collection(db, 'auditoria_eliminaciones'), {
          tipo: 'comentario',
          seccionId,
          mensajeId,
          autorOriginalUid: datosParaAuditoria.uid || null,
          autorOriginalNombre: datosParaAuditoria.nombre || null,
          textoOriginal: datosParaAuditoria.texto || null,
          eliminadoPorUid: admin ? admin.uid : null,
          eliminadoPorEmail: admin ? admin.email : null,
          ts: serverTimestamp()
        });
      } catch (e) {
        console.warn('[Comentarios] No se pudo registrar la auditoría de eliminación:', e.message);
      }
    }
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
    const esAutor = !!contUid && m.uid === contUid;
    const puedeBorrar = esAdmin || esAutor;
    const puedeEditar = esAutor; // edición reservada al autor; admin modera con "Eliminar"
    return `
      <div class="com-item" id="com-${m.id}" data-mensaje-id="${m.id}">
        <div class="com-item-head">
          <span class="com-item-nombre">${_escapeHTML(m.nombre || 'Usuario')}</span>
          <span class="com-item-fecha">${_fechaCorta(m.ts)}${m.editado ? '<span class="com-item-editado">(editado)</span>' : ''}</span>
        </div>
        <div class="com-item-texto" id="com-texto-${m.id}">${_escapeHTML(m.texto)}</div>
        <div class="com-item-acciones">
          <button class="com-btn-responder" data-id="${m.id}">↩ Responder</button>
          ${puedeEditar ? `<button class="com-btn-editar" data-id="${m.id}">✏️ Editar</button>` : ''}
          ${puedeBorrar ? `<button class="com-btn-borrar" data-id="${m.id}" data-uid="${_escapeHTML(m.uid || '')}" data-nombre="${_escapeHTML(m.nombre || '')}">🗑 Eliminar</button>` : ''}
        </div>
        <div class="com-edit-form" id="edit-form-${m.id}">
          <textarea maxlength="800">${_escapeHTML(m.texto)}</textarea>
          <button class="com-btn-guardar" data-id="${m.id}">Guardar</button>
          <button type="button" class="com-btn-cancelar" data-id="${m.id}">Cancelar</button>
        </div>
        <div class="com-reply-form" id="reply-form-${m.id}">
          <textarea placeholder="Escribí tu respuesta..." maxlength="800"></textarea>
          <button class="com-btn-emoji" type="button">😊</button>
          <div class="com-emoji-picker oculto"></div>
          <button class="com-btn-enviar-reply" data-parent="${m.id}">Responder</button>
        </div>
        <div class="com-respuestas" id="respuestas-${m.id}">
          ${(porPadre[m.id] || []).map(r => _renderComentario(r, porPadre, contUid, esAdmin)).join('')}
        </div>
      </div>`;
  }

  function _adjuntarEventos(lista, seccionId, anchorNode) {
    // Responder: abrir/cerrar form de respuesta (con su propio picker de emojis)
    lista.querySelectorAll('.com-btn-responder').forEach(btn => {
      btn.addEventListener('click', () => {
        const form = lista.querySelector(`#reply-form-${btn.dataset.id}`);
        if (!form) return;
        form.classList.toggle('activo');
        if (form.classList.contains('activo')) {
          const ta = form.querySelector('textarea');
          const btnEmoji = form.querySelector('.com-btn-emoji');
          const picker = form.querySelector('.com-emoji-picker');
          if (ta && picker && !picker.dataset.armado) {
            _armarEmojiPicker(ta, picker);
            picker.dataset.armado = '1';
          }
          if (btnEmoji && picker) {
            btnEmoji.onclick = () => _togglePicker(picker);
          }
          ta && ta.focus();
        }
      });
    });

    // Enviar respuesta
    lista.querySelectorAll('.com-btn-enviar-reply').forEach(btn => {
      btn.addEventListener('click', async () => {
        const form = btn.closest('.com-reply-form');
        const textarea = form.querySelector('textarea');
        const texto = textarea.value.trim();
        if (texto.length < 3) { textarea.focus(); return; }
        // Filtro de lenguaje inapropiado
        if (window.IARFiltro && window.IARFiltro.contieneMalasPalabras(texto)) {
          alert('⚠️ Tu respuesta contiene lenguaje inapropiado. Por favor, revisala antes de enviar.');
          textarea.focus();
          return;
        }
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

    // Editar: abrir/cerrar form
    lista.querySelectorAll('.com-btn-editar').forEach(btn => {
      btn.addEventListener('click', () => {
        const form = lista.querySelector(`#edit-form-${btn.dataset.id}`);
        const textoDiv = lista.querySelector(`#com-texto-${btn.dataset.id}`);
        if (!form) return;
        form.classList.toggle('activo');
        if (textoDiv) textoDiv.style.display = form.classList.contains('activo') ? 'none' : '';
        if (form.classList.contains('activo')) {
          const ta = form.querySelector('textarea');
          ta && ta.focus();
        }
      });
    });

    // Editar: cancelar
    lista.querySelectorAll('.com-edit-form .com-btn-cancelar').forEach(btn => {
      btn.addEventListener('click', () => {
        const form = lista.querySelector(`#edit-form-${btn.dataset.id}`);
        const textoDiv = lista.querySelector(`#com-texto-${btn.dataset.id}`);
        if (form) form.classList.remove('activo');
        if (textoDiv) textoDiv.style.display = '';
      });
    });

    // Editar: guardar
    lista.querySelectorAll('.com-edit-form .com-btn-guardar').forEach(btn => {
      btn.addEventListener('click', async () => {
        const form = btn.closest('.com-edit-form');
        const textarea = form.querySelector('textarea');
        const nuevoTexto = textarea.value.trim();
        if (nuevoTexto.length < 5) { textarea.focus(); return; }
        // Filtro de lenguaje inapropiado
        if (window.IARFiltro && window.IARFiltro.contieneMalasPalabras(nuevoTexto)) {
          alert('⚠️ El comentario editado contiene lenguaje inapropiado. Por favor, revisalo.');
          textarea.focus();
          return;
        }
        btn.disabled = true;
        try {
          await _editarComentario(seccionId, btn.dataset.id, nuevoTexto);
          await renderCajaComentarios(seccionId, anchorNode);
        } catch (e) {
          alert('No se pudo guardar la edición: ' + (e.message || ''));
          btn.disabled = false;
        }
      });
    });

    // Borrar
    lista.querySelectorAll('.com-btn-borrar').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Eliminar este comentario? No se puede deshacer.')) return;
        try {
          const textoDiv = lista.querySelector(`#com-texto-${btn.dataset.id}`);
          const datosParaAuditoria = {
            uid: btn.dataset.uid || null,
            nombre: btn.dataset.nombre || null,
            texto: textoDiv ? textoDiv.textContent : null
          };
          await _borrarComentario(seccionId, btn.dataset.id, datosParaAuditoria);
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
          <div class="com-form-campo">
            <textarea id="com-nuevo-${seccionId}" placeholder="¿Encontraste un error o tenés una sugerencia sobre este examen?" maxlength="800"></textarea>
          </div>
          <div class="com-form-botones">
            <button class="com-btn-emoji" type="button" id="com-btn-emoji-${seccionId}">😊</button>
            <button class="com-btn-enviar" id="com-btn-enviar-${seccionId}">Comentar</button>
          </div>
          <div class="com-emoji-picker oculto" id="com-picker-${seccionId}"></div>
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
    const btnEmoji = wrapper.querySelector(`#com-btn-emoji-${seccionId}`);
    const picker = wrapper.querySelector(`#com-picker-${seccionId}`);

    if (btnEmoji && picker && textarea) {
      _armarEmojiPicker(textarea, picker);
      btnEmoji.addEventListener('click', () => _togglePicker(picker));
    }

    // ── Bloqueo visual del form si el usuario es demo ──
    const esAdmin = !!window._esAdmin;
    const licencia = window._licenciaActual;
    const esDemo = !esAdmin && licencia && licencia.esDemo === true;

    if (esDemo) {
      textarea.disabled = true;
      textarea.placeholder = '🔒 Los usuarios demo no pueden dejar comentarios.';
      btnEnviar.disabled = true;
      btnEnviar.title = 'Disponible con licencia completa';
      const aviso = document.createElement('p');
      aviso.className = 'com-msg-error';
      aviso.style.cssText = 'display:block;margin-top:4px;';
      aviso.textContent = '⚠️ Los comentarios están disponibles solo para usuarios con licencia completa. Podés usar el canal de Sugerencias.';
      textarea.parentElement.appendChild(aviso);
    }

    btnEnviar.onclick = async () => {
      if (esDemo) return; // doble protección
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
      // ── Filtro de lenguaje inapropiado ──
      if (window.IARFiltro && window.IARFiltro.contieneMalasPalabras(texto)) {
        errorDiv.textContent = '⚠️ Tu comentario contiene lenguaje inapropiado. Por favor, revisalo antes de publicar.';
        errorDiv.style.display = 'block';
        return;
      }
      btnEnviar.disabled = true;
      try {
        await _crearComentario(seccionId, texto, null);
        textarea.value = '';
        await renderCajaComentarios(seccionId, anchorNode);
      } catch (e) {
        errorDiv.textContent = e.message || 'No se pudo publicar el comentario.';
        errorDiv.style.display = 'block';
      } finally {
        btnEnviar.disabled = false;
      }
    };
  }

  // Cerrar cualquier picker abierto si se hace clic afuera
  document.addEventListener('click', (e) => {
    if (e.target.closest('.com-btn-emoji') || e.target.closest('.com-emoji-picker')) return;
    document.querySelectorAll('.com-emoji-picker').forEach(p => p.classList.add('oculto'));
  });

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
