/* ============================================================
   v2 sugerencias.js — Canal privado de sugerencias usuario <-> admin
   ============================================================
   Requiere que firebase-auth.js ya haya expuesto:
     window._firestoreDB_comentarios  -> instancia Firestore (db)
     window._authCurrentUser          -> auth.currentUser
     window._esAdmin                  -> bool

   Uso (usuario):
     window.IARSugerencias.abrirPanelUsuario();
       -> abre un modal con: form para crear sugerencia nueva +
          lista de sugerencias propias (cada una es un mini-chat).

   Uso (admin, desde el panel de notificaciones):
     window.IARSugerencias.abrirHiloAdmin(sugerenciaId);
       -> abre el hilo completo de una sugerencia puntual para
          que el admin la lea, responda y cambie el estado.

   Cambios v2:
     - Filtro de lenguaje inapropiado vía window.IARFiltro (filtro_palabras.js).
       (Los usuarios demo SÍ pueden enviar sugerencias — sin restricción aquí.)

   Estructura en Firestore (coherente con reglas_firestore_database_18):
     sugerencias/{sugerenciaId}
       { uid, nombre, mensaje, estado:'no_resuelto'|'resuelto',
         fecha_creacion, fecha_resolucion?, resuelta_por? }
     sugerencias/{sugerenciaId}/respuestas/{respuestaId}
       { uid, nombre, esAdmin, texto, ts }
     notificaciones_admin/{notifId}
       { tipo:'sugerencia', sugerenciaId, uid, nombre, texto, ts, leido }
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
    if (document.getElementById('sugerencias-styles')) return;
    const s = document.createElement('style');
    s.id = 'sugerencias-styles';
    s.textContent = `
      #sug-overlay {
        position: fixed; inset: 0; background: rgba(15,23,42,.55);
        display: flex; align-items: flex-start; justify-content: center;
        overflow-y: auto; padding: 40px 16px; z-index: 9999;
      }
      .sug-box {
        background: #fff; border-radius: 14px; width: 100%; max-width: 640px;
        max-height: calc(100vh - 80px); overflow-y: auto;
        padding: 22px 24px 28px; box-shadow: 0 20px 60px rgba(0,0,0,.35);
        box-sizing: border-box;
      }
      .sug-titulo {
        display: flex; align-items: center; justify-content: space-between;
        font-size: 1.2rem; font-weight: 800; color: #0f172a;
        border-bottom: 2px solid #e2e8f0; padding-bottom: 12px; margin-bottom: 16px;
      }
      .sug-btn-cerrar {
        background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1;
        border-radius: 7px; padding: 6px 12px; font-size: .82rem; font-weight: 700; cursor: pointer;
      }
      .sug-btn-cerrar:hover { background: #e2e8f0; }
      .sug-nueva-form { margin-bottom: 20px; }
      .sug-nueva-form textarea {
        width: 100%; min-height: 70px; border: 1.5px solid #cbd5e1; border-radius: 8px;
        padding: 10px 12px; font-size: .9rem; resize: vertical; font-family: inherit; box-sizing: border-box;
      }
      .sug-nueva-form-botones { display: flex; justify-content: flex-end; margin-top: 8px; }
      .sug-btn-enviar {
        background: #ea580c; color: #fff; border: none; border-radius: 8px;
        padding: 9px 18px; font-size: .85rem; font-weight: 700; cursor: pointer;
      }
      .sug-btn-enviar:disabled { opacity: .5; cursor: not-allowed; }
      .sug-msg-error { color: #dc2626; font-size: .78rem; margin-top: 6px; }
      .sug-lista-titulo { font-size: .95rem; font-weight: 700; color: #1e293b; margin: 18px 0 10px; }
      .sug-item {
        background: #fff7ed; border: 1.5px solid #fdba74; border-radius: 10px;
        padding: 12px 14px; margin-bottom: 12px;
      }
      .sug-item-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
      .sug-item-fecha { font-size: .72rem; color: #92400e; }
      .sug-estado-badge {
        font-size: .72rem; font-weight: 800; padding: 4px 10px; border-radius: 999px; letter-spacing: .02em;
      }
      .sug-estado-no_resuelto { background: #fee2e2; color: #dc2626; }
      .sug-estado-resuelto { background: #dcfce7; color: #15803d; }
      .sug-item-mensaje { font-size: .88rem; color: #1e293b; margin-top: 6px; white-space: pre-wrap; word-break: break-word; }
      .sug-item-nombre { font-weight: 700; font-size: .82rem; color: #9a3412; }
      .sug-hilo { margin-top: 10px; border-top: 1px dashed #fdba74; padding-top: 10px; }
      .sug-msg-burbuja {
        max-width: 85%; margin-bottom: 8px; padding: 8px 12px; border-radius: 10px; font-size: .85rem;
        white-space: pre-wrap; word-break: break-word;
      }
      .sug-msg-usuario { background: #fff; border: 1px solid #fed7aa; margin-right: auto; }
      .sug-msg-admin { background: #1e40af; color: #fff; margin-left: auto; }
      .sug-msg-meta { font-size: .68rem; opacity: .75; margin-top: 3px; }
      .sug-reply-row { display: flex; gap: 8px; margin-top: 10px; }
      .sug-reply-row textarea {
        flex: 1; min-height: 38px; border: 1.5px solid #cbd5e1; border-radius: 8px;
        padding: 7px 10px; font-size: .85rem; resize: vertical; font-family: inherit; box-sizing: border-box;
      }
      .sug-reply-row button {
        background: #ea580c; color: #fff; border: none; border-radius: 8px;
        padding: 0 16px; font-size: .82rem; font-weight: 700; cursor: pointer;
      }
      .sug-vacio { font-size: .85rem; color: #94a3b8; font-style: italic; }
      .sug-toggle-resuelto {
        font-size: .75rem; font-weight: 700; padding: 4px 10px; border-radius: 999px;
        border: none; cursor: pointer; margin-left: 6px;
      }
      .sug-toggle-no { background: #dc2626; color: #fff; }
      .sug-toggle-si { background: #94a3b8; color: #fff; }
      .sug-toggle-no.activo { background: #dc2626; color: #fff; }
      .sug-toggle-si.activo { background: #16a34a; color: #fff; }
      .sug-btn-eliminar {
        font-size: .75rem; font-weight: 700; padding: 4px 10px; border-radius: 999px;
        border: 1px solid #fca5a5; cursor: pointer; margin-left: 6px;
        background: #fee2e2; color: #dc2626;
      }
      .sug-btn-eliminar:hover { background: #fecaca; }
      .sug-btn-eliminar:disabled { opacity: .5; cursor: not-allowed; }

      @media (max-width: 640px) {
        #sug-overlay { padding: 16px 8px; }
        .sug-box { padding: 16px 14px 22px; max-height: calc(100vh - 32px); }
      }
    `;
    document.head.appendChild(s);
  }

  // ── Crear sugerencia nueva + notificación admin ──
  async function _crearSugerencia(mensaje) {
    const db = window._firestoreDB_comentarios;
    const user = window._authCurrentUser;
    if (!db || !user) throw new Error('Necesitás iniciar sesión para enviar una sugerencia.');
    const { collection, addDoc, serverTimestamp } = await _fs();

    const nombre = (user.email || 'Usuario').split('@')[0];
    const ref = collection(db, 'sugerencias');
    const nuevoDoc = await addDoc(ref, {
      uid: user.uid,
      nombre,
      mensaje,
      estado: 'no_resuelto',
      fecha_creacion: serverTimestamp()
    });

    try {
      const notifRef = collection(db, 'notificaciones_admin');
      await addDoc(notifRef, {
        tipo: 'sugerencia',
        sugerenciaId: nuevoDoc.id,
        uid: user.uid,
        nombre,
        texto: mensaje,
        ts: serverTimestamp(),
        leido: false
      });
    } catch (e) {
      console.warn('[Sugerencias] No se pudo crear la notificación admin:', e.message);
    }

    return nuevoDoc.id;
  }

  async function _responderSugerencia(sugerenciaId, texto, esAdmin) {
    const db = window._firestoreDB_comentarios;
    const user = window._authCurrentUser;
    if (!db || !user) throw new Error('Necesitás iniciar sesión.');
    const { collection, doc, addDoc, getDoc, serverTimestamp } = await _fs();

    const nombre = (user.email || 'Usuario').split('@')[0];
    const respRef = collection(db, 'sugerencias', sugerenciaId, 'respuestas');
    await addDoc(respRef, {
      uid: user.uid,
      nombre,
      esAdmin: !!esAdmin,
      texto,
      ts: serverTimestamp()
    });

    // Si responde el admin, notificar implícitamente solo actualizando ts
    // de lectura no es necesario aquí; si responde el usuario, avisar al admin.
    if (!esAdmin) {
      try {
        const notifRef = collection(db, 'notificaciones_admin');
        await addDoc(notifRef, {
          tipo: 'sugerencia',
          sugerenciaId,
          uid: user.uid,
          nombre,
          texto: '↩ ' + texto,
          ts: serverTimestamp(),
          leido: false
        });
      } catch (e) { console.warn('[Sugerencias] No se pudo notificar respuesta:', e.message); }
    }
  }

  async function _cambiarEstadoSugerencia(sugerenciaId, nuevoEstado) {
    const db = window._firestoreDB_comentarios;
    const user = window._authCurrentUser;
    const { doc, updateDoc, serverTimestamp } = await _fs();
    const datos = { estado: nuevoEstado };
    if (nuevoEstado === 'resuelto') {
      datos.fecha_resolucion = serverTimestamp();
      datos.resuelta_por = (user && user.email) || 'admin';
    }
    await updateDoc(doc(db, 'sugerencias', sugerenciaId), datos);
  }

  // Solo el admin puede eliminar una sugerencia (moderación). Queda registro
  // en auditoria_eliminaciones, ya que es una acción irreversible sobre
  // contenido ajeno.
  async function _eliminarSugerencia(sugerencia) {
    const db = window._firestoreDB_comentarios;
    const admin = window._authCurrentUser;
    const { doc, deleteDoc, collection, addDoc, serverTimestamp } = await _fs();

    await deleteDoc(doc(db, 'sugerencias', sugerencia.id));

    try {
      await addDoc(collection(db, 'auditoria_eliminaciones'), {
        tipo: 'sugerencia',
        sugerenciaId: sugerencia.id,
        autorOriginalUid: sugerencia.uid || null,
        autorOriginalNombre: sugerencia.nombre || null,
        textoOriginal: sugerencia.mensaje || null,
        eliminadoPorUid: admin ? admin.uid : null,
        eliminadoPorEmail: admin ? admin.email : null,
        ts: serverTimestamp()
      });
    } catch (e) {
      console.warn('[Sugerencias] No se pudo registrar la auditoría de eliminación:', e.message);
    }
  }

  async function _cargarSugerenciasUsuario(uid) {
    const db = window._firestoreDB_comentarios;
    const { collection, getDocs, query, where, orderBy } = await _fs();
    const q = query(collection(db, 'sugerencias'), where('uid', '==', uid), orderBy('fecha_creacion', 'desc'));
    const snap = await getDocs(q);
    const out = [];
    snap.forEach(d => out.push({ id: d.id, ...d.data() }));
    return out;
  }

  async function _cargarSugerenciaPorId(sugerenciaId) {
    const db = window._firestoreDB_comentarios;
    const { doc, getDoc } = await _fs();
    const snap = await getDoc(doc(db, 'sugerencias', sugerenciaId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  }

  async function _cargarRespuestas(sugerenciaId) {
    const db = window._firestoreDB_comentarios;
    const { collection, getDocs, query, orderBy } = await _fs();
    const q = query(collection(db, 'sugerencias', sugerenciaId, 'respuestas'), orderBy('ts', 'asc'));
    const snap = await getDocs(q);
    const out = [];
    snap.forEach(d => out.push({ id: d.id, ...d.data() }));
    return out;
  }

  function _renderHiloHTML(sugerencia, respuestas, esAdmin) {
    const burbujasHTML = respuestas.map(r => `
      <div class="sug-msg-burbuja ${r.esAdmin ? 'sug-msg-admin' : 'sug-msg-usuario'}">
        ${_escapeHTML(r.texto)}
        <div class="sug-msg-meta">${r.esAdmin ? '🛠️ Admin' : _escapeHTML(r.nombre || 'Usuario')} · ${_fechaCorta(r.ts)}</div>
      </div>`).join('');

    const estadoLabel = sugerencia.estado === 'resuelto' ? 'Resuelto' : 'No resuelto';

    return `
      <div class="sug-item" id="sug-item-${sugerencia.id}" data-sug-id="${sugerencia.id}">
        <div class="sug-item-head">
          <div>
            <span class="sug-item-nombre">${_escapeHTML(sugerencia.nombre || 'Usuario')}</span>
            <span class="sug-item-fecha"> · ${_fechaCorta(sugerencia.fecha_creacion)}</span>
          </div>
          <div>
            <span class="sug-estado-badge sug-estado-${sugerencia.estado}">${estadoLabel}</span>
            ${esAdmin ? `
              <button class="sug-toggle-resuelto sug-toggle-no ${sugerencia.estado === 'no_resuelto' ? 'activo' : ''}" data-id="${sugerencia.id}" data-estado="no_resuelto">No resuelto</button>
              <button class="sug-toggle-resuelto sug-toggle-si ${sugerencia.estado === 'resuelto' ? 'activo' : ''}" data-id="${sugerencia.id}" data-estado="resuelto">Resuelto</button>
              <button class="sug-btn-eliminar" data-id="${sugerencia.id}" data-uid="${_escapeHTML(sugerencia.uid || '')}" data-nombre="${_escapeHTML(sugerencia.nombre || '')}">🗑 Eliminar</button>
            ` : ''}
          </div>
        </div>
        <div class="sug-item-mensaje" id="sug-mensaje-${sugerencia.id}">${_escapeHTML(sugerencia.mensaje)}</div>
        <div class="sug-hilo" id="sug-hilo-${sugerencia.id}">
          ${burbujasHTML || '<em class="sug-vacio">Sin respuestas todavía.</em>'}
        </div>
        <div class="sug-reply-row">
          <textarea id="sug-reply-ta-${sugerencia.id}" placeholder="${esAdmin ? 'Responder al usuario...' : 'Agregar un mensaje a este hilo...'}" maxlength="1000"></textarea>
          <button class="sug-btn-reply" data-id="${sugerencia.id}">Enviar</button>
        </div>
      </div>`;
  }

  function _adjuntarEventosHilo(container, esAdmin, onUpdate, onDelete) {
    container.querySelectorAll('.sug-btn-reply').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const ta = container.querySelector(`#sug-reply-ta-${id}`);
        const texto = ta.value.trim();
        if (!texto) { ta.focus(); return; }
        // Filtro de lenguaje inapropiado
        if (window.IARFiltro && window.IARFiltro.contieneMalasPalabras(texto)) {
          alert('⚠️ Tu mensaje contiene lenguaje inapropiado. Por favor, revisalo antes de enviar.');
          ta.focus();
          return;
        }
        btn.disabled = true;
        try {
          await _responderSugerencia(id, texto, esAdmin);
          ta.value = '';
          if (typeof onUpdate === 'function') await onUpdate();
        } catch (e) {
          alert('No se pudo enviar: ' + (e.message || ''));
        } finally {
          btn.disabled = false;
        }
      });
    });

    if (esAdmin) {
      container.querySelectorAll('.sug-toggle-resuelto').forEach(btn => {
        btn.addEventListener('click', async () => {
          try {
            await _cambiarEstadoSugerencia(btn.dataset.id, btn.dataset.estado);
            if (typeof onUpdate === 'function') await onUpdate();
          } catch (e) {
            alert('No se pudo actualizar el estado: ' + (e.message || ''));
          }
        });
      });

      container.querySelectorAll('.sug-btn-eliminar').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm('¿Eliminar esta sugerencia y todo su hilo? No se puede deshacer.')) return;
          btn.disabled = true;
          try {
            const mensajeDiv = container.querySelector(`#sug-mensaje-${btn.dataset.id}`);
            await _eliminarSugerencia({
              id: btn.dataset.id,
              uid: btn.dataset.uid,
              nombre: btn.dataset.nombre,
              mensaje: mensajeDiv ? mensajeDiv.textContent : null
            });
            if (typeof onDelete === 'function') await onDelete();
            else if (typeof onUpdate === 'function') await onUpdate();
          } catch (e) {
            alert('No se pudo eliminar: ' + (e.message || ''));
            btn.disabled = false;
          }
        });
      });
    }
  }

  // ── PANEL DE USUARIO: crear sugerencia + ver las propias ──
  async function abrirPanelUsuario() {
    if (!window._authCurrentUser) {
      alert('Necesitás iniciar sesión para usar Sugerencias.');
      return;
    }
    _inyectarEstilos();

    let overlay = document.getElementById('sug-overlay');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'sug-overlay';
    overlay.innerHTML = `
      <div class="sug-box">
        <div class="sug-titulo">
          🟧 Sugerencias
          <button class="sug-btn-cerrar" id="sug-cerrar">✕ Cerrar</button>
        </div>
        <div class="sug-nueva-form">
          <textarea id="sug-nuevo-mensaje" placeholder="Escribí tu sugerencia o consulta privada para el administrador..." maxlength="1000"></textarea>
          <div id="sug-nuevo-error" class="sug-msg-error" style="display:none;"></div>
          <div class="sug-nueva-form-botones">
            <button class="sug-btn-enviar" id="sug-btn-crear">Enviar sugerencia</button>
          </div>
        </div>
        <div class="sug-lista-titulo">Tus sugerencias</div>
        <div id="sug-lista-usuario"><em class="sug-vacio">Cargando...</em></div>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById('sug-cerrar').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    async function _refrescarLista() {
      const lista = document.getElementById('sug-lista-usuario');
      if (!lista) return;
      try {
        const sugerencias = await _cargarSugerenciasUsuario(window._authCurrentUser.uid);
        if (!sugerencias.length) {
          lista.innerHTML = '<em class="sug-vacio">Todavía no enviaste ninguna sugerencia.</em>';
          return;
        }
        const partes = await Promise.all(sugerencias.map(async s => {
          const respuestas = await _cargarRespuestas(s.id);
          return _renderHiloHTML(s, respuestas, false);
        }));
        lista.innerHTML = partes.join('');
        _adjuntarEventosHilo(lista, false, _refrescarLista);
      } catch (e) {
        lista.innerHTML = '<em style="color:#dc2626;">No se pudieron cargar tus sugerencias.</em>';
        console.warn('[Sugerencias] Error al cargar:', e.message);
      }
    }

    const btnCrear = document.getElementById('sug-btn-crear');
    const taNuevo = document.getElementById('sug-nuevo-mensaje');
    const errorDiv = document.getElementById('sug-nuevo-error');

    btnCrear.addEventListener('click', async () => {
      errorDiv.style.display = 'none';
      const mensaje = taNuevo.value.trim();
      if (mensaje.length < 5) {
        errorDiv.textContent = 'El mensaje debe tener al menos 5 caracteres.';
        errorDiv.style.display = 'block';
        return;
      }
      // Filtro de lenguaje inapropiado
      if (window.IARFiltro && window.IARFiltro.contieneMalasPalabras(mensaje)) {
        errorDiv.textContent = '⚠️ Tu sugerencia contiene lenguaje inapropiado. Por favor, revisala antes de enviar.';
        errorDiv.style.display = 'block';
        return;
      }
      btnCrear.disabled = true;
      try {
        await _crearSugerencia(mensaje);
        taNuevo.value = '';
        await _refrescarLista();
      } catch (e) {
        errorDiv.textContent = e.message || 'No se pudo enviar la sugerencia.';
        errorDiv.style.display = 'block';
      } finally {
        btnCrear.disabled = false;
      }
    });

    await _refrescarLista();
  }

  // ── HILO ADMIN: ver/responder/cambiar estado de UNA sugerencia puntual ──
  async function abrirHiloAdmin(sugerenciaId) {
    if (!window._esAdmin) return;
    _inyectarEstilos();

    let overlay = document.getElementById('sug-overlay');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'sug-overlay';
    overlay.innerHTML = `
      <div class="sug-box">
        <div class="sug-titulo">
          🟧 Sugerencia de usuario
          <button class="sug-btn-cerrar" id="sug-cerrar">✕ Cerrar</button>
        </div>
        <div id="sug-hilo-admin-cont"><em class="sug-vacio">Cargando...</em></div>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById('sug-cerrar').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    async function _refrescar() {
      const cont = document.getElementById('sug-hilo-admin-cont');
      if (!cont) return;
      try {
        const sugerencia = await _cargarSugerenciaPorId(sugerenciaId);
        if (!sugerencia) {
          cont.innerHTML = '<em style="color:#dc2626;">Esta sugerencia ya no existe.</em>';
          return;
        }
        const respuestas = await _cargarRespuestas(sugerenciaId);
        cont.innerHTML = _renderHiloHTML(sugerencia, respuestas, true);
        _adjuntarEventosHilo(cont, true, _refrescar, async () => {
          cont.innerHTML = '<em class="sug-vacio">Sugerencia eliminada.</em>';
          setTimeout(() => { const ov = document.getElementById('sug-overlay'); if (ov) ov.remove(); }, 900);
        });
      } catch (e) {
        cont.innerHTML = '<em style="color:#dc2626;">No se pudo cargar la sugerencia.</em>';
        console.warn('[Sugerencias] Error al cargar hilo admin:', e.message);
      }
    }

    await _refrescar();
  }

  // El botón flotante "Sugerencias" se crea desde script.js (buildProgressUI),
  // junto al botón "Ver mi progreso", para compartir su misma lógica de
  // posicionamiento y de visibilidad (solo en el menú principal).
  window.IARSugerencias = {
    abrirPanelUsuario,
    abrirHiloAdmin
  };
})();
