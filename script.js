/* ========== script.js ========== */

// Variable global de preguntas — se llena desde Firestore (ya no viene de preguntasiar.js)
if (typeof preguntasPorSeccion === 'undefined') {
  var preguntasPorSeccion = {};
}

// ======== URL BASE PARA IMÁGENES ========
// En servidor local usa ruta relativa; en producción apunta a GitHub Pages.
const IMAGENES_BASE_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.168.'))
  ? ''
  : 'https://examenesiaruba.github.io/';

function getImagenUrl(path) {
  if (!path) return '';
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return IMAGENES_BASE_URL + path;
}
/* Requisitos:
   1) Orden de preguntas ALEATORIO al inicio; orden de opciones aleatorio por pregunta.
      - Las preguntas se mezclan al inicio de cada intento
      - Las preguntas respondidas quedan arriba
      - Las preguntas sin responder se mantienen abajo en orden aleatorio
   2) Progreso y selecciones persistentes en localStorage hasta completar el cuestionario.
      se limpia el estado para permitir un nuevo intento.
   5) Cada pregunta tiene botón "Responder"; pinta verde/rojo y marca "✅/❌".
   6) Botón flotante "Ver mi progreso" con ventana flotante.
   7) Mantener posición de scroll al regresar al menú principal.
   8) Navegación con botones del navegador (atrás/adelante).
*/

(function () {
  // ======== Claves de almacenamiento ========
  const STORAGE_KEY = "quiz_state_v3";             // Estado persistente por sección (v3 para nueva funcionalidad)
  const ATTEMPT_LOG_KEY = "quiz_attempt_log_v1";   // Historial de intentos
  const SCROLL_POSITION_KEY = "quiz_scroll_position_v1"; // Posición del scroll

  // ======== Estado en memoria (se sincroniza con localStorage Y Firestore) ========
  // Estructura por sección:
  // state[seccionId] = {
  //   shuffleFrozen: false,
  //   shuffleMap: { [qIndex]: { [mixedIndex]: originalIndex } },
  //   questionOrder: [array de índices de preguntas mezclados],
  //   answers: { [qIndex]: [mixedIndicesSeleccionados] },
  //   graded: { [qIndex]: true|false },
  //   totalShown: false,
  //   explanationShown: { [qIndex]: true|false }  // si se mostró la explicación
  // }
  let state = loadJSON(STORAGE_KEY, {});
  let attemptLog = loadJSON(ATTEMPT_LOG_KEY, []);

  // ======== SINCRONIZACIÓN CON FIRESTORE ========
  // Ruta: progreso/{uid}/secciones/{seccionId}  → estado del cuestionario
  //        progreso/{uid}/historial              → { entries: [...] }
  //        progreso/{uid}/completados            → { [seccionId]: true }

  let _firestoreUID = null;     // UID del usuario autenticado
  let _firestoreDB  = null;     // instancia de Firestore (se inyecta desde firebase-auth.js)
  let _pendingFSSave = {};      // { [seccionId]: timeoutId } — debounce por sección
  const FS_DEBOUNCE_MS = 1500;  // ms de espera antes de escribir en Firestore

  // firebase-auth.js inyecta estas referencias una vez que el usuario está autenticado
  window._setFirestoreSync = function(uid, dbInstance) {
    // Si se está cerrando sesión (uid=null), limpiar historial local de la sesión anterior
    if (!uid) {
      attemptLog = [];
      localStorage.removeItem(ATTEMPT_LOG_KEY);
      console.log('[IAR Sync] 🧹 Historial local limpiado al cerrar sesión');
    }
    _firestoreUID = uid;
    _firestoreDB  = dbInstance;
  };

  // ---- Helpers de Firestore dinámica ----
  async function _fsDoc(path) {
    // path: array de strings, ej. ['progreso', uid, 'secciones', seccionId]
    const { doc, getFirestore } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    return doc(_firestoreDB, ...path);
  }

  // ---- Guardar estado de UNA sección en Firestore (con debounce) ----
  function _guardarSeccionFirestore(seccionId) {
    if (!_firestoreUID || !_firestoreDB) return;
    // Cancelar el timeout anterior si existe
    if (_pendingFSSave[seccionId]) clearTimeout(_pendingFSSave[seccionId]);
    _pendingFSSave[seccionId] = setTimeout(async () => {
      delete _pendingFSSave[seccionId];
      try {
        const { doc, setDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
        // IMPORTANTE: leer SIEMPRE desde localStorage (fuente de verdad local)
        // porque script_onebyone.js escribe ahí directamente sin actualizar state en memoria.
        const rawState = localStorage.getItem(STORAGE_KEY);
        const allState = rawState ? JSON.parse(rawState) : {};
        const secData = allState[seccionId];
        if (!secData) return;
        const docRef = doc(_firestoreDB, 'progreso', _firestoreUID, 'secciones', seccionId);
        await setDoc(docRef, { ...secData, _ts: serverTimestamp() });
        console.log('[IAR Sync] ✅ Sección guardada en Firestore:', seccionId);
      } catch(err) {
        console.warn('[IAR Sync] ⚠️ Error guardando sección en Firestore:', seccionId, err.code || err.message);
      }
    }, FS_DEBOUNCE_MS);
  }

  // ---- Versión inmediata (sin debounce) para uso desde script_onebyone.js ----
  async function _guardarSeccionFirestoreInmediato(seccionId) {
    if (!_firestoreUID || !_firestoreDB) return;
    // Cancelar debounce pendiente si existe
    if (_pendingFSSave[seccionId]) {
      clearTimeout(_pendingFSSave[seccionId]);
      delete _pendingFSSave[seccionId];
    }
    try {
      const { doc, setDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      // Leer desde localStorage (fuente de verdad local)
      const rawState = localStorage.getItem(STORAGE_KEY);
      const allState = rawState ? JSON.parse(rawState) : {};
      const secData = allState[seccionId];
      if (!secData) return;
      const docRef = doc(_firestoreDB, 'progreso', _firestoreUID, 'secciones', seccionId);
      await setDoc(docRef, { ...secData, _ts: serverTimestamp() });
      console.log('[IAR Sync] ✅ (inmediato) Sección guardada en Firestore:', seccionId);
    } catch(err) {
      console.warn('[IAR Sync] ⚠️ Error guardando sección en Firestore (inmediato):', seccionId, err.code || err.message);
    }
  }

  // Exponer globalmente para que script_onebyone.js pueda llamarlas
  window._guardarSeccionFirestore = _guardarSeccionFirestore;
  window._guardarSeccionFirestoreInmediato = _guardarSeccionFirestoreInmediato;

  // ---- Borrar el progreso de UNA sección en Firestore (al reiniciar) ----
  // CRÍTICO: sin esto, al volver al cuestionario Firestore restaura el progreso viejo.
  async function _borrarSeccionFirestore(seccionId) {
    if (!_firestoreUID || !_firestoreDB) return;
    // Cancelar TODOS los guardados pendientes (no solo el de esta sección)
    // para evitar que un debounce en vuelo suba datos viejos después del delete
    Object.keys(_pendingFSSave).forEach(function(sid) {
      clearTimeout(_pendingFSSave[sid]);
      delete _pendingFSSave[sid];
    });
    try {
      const { doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      const docRef = doc(_firestoreDB, 'progreso', _firestoreUID, 'secciones', seccionId);
      await deleteDoc(docRef);
      console.log('[IAR Sync] 🗑️ Sección borrada de Firestore (reinicio):', seccionId);
    } catch(err) {
      console.warn('[IAR Sync] ⚠️ Error borrando sección de Firestore:', seccionId, err.code || err.message);
    }
  }
  window._borrarSeccionFirestore = _borrarSeccionFirestore;

  // ---- Guardar historial de intentos en Firestore ----
  async function _guardarHistorialFirestore() {
    if (!_firestoreUID || !_firestoreDB) return;
    try {
      const { doc, setDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      const docRef = doc(_firestoreDB, 'progreso', _firestoreUID, 'datos', 'historial');
      await setDoc(docRef, { entries: attemptLog, _ts: serverTimestamp() });
      console.log('[IAR Sync] ✅ Historial guardado en Firestore');
    } catch(err) {
      console.warn('[IAR Sync] ⚠️ Error guardando historial en Firestore:', err.code || err.message);
    }
  }

  // ---- Guardar completados en Firestore ----
  async function _guardarCompletadosFirestore(completados) {
    if (!_firestoreUID || !_firestoreDB) return;
    try {
      const { doc, setDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
      const docRef = doc(_firestoreDB, 'progreso', _firestoreUID, 'datos', 'completados');
      await setDoc(docRef, { completados, _ts: serverTimestamp() });
      console.log('[IAR Sync] ✅ Completados guardados en Firestore');
    } catch(err) {
      console.warn('[IAR Sync] ⚠️ Error guardando completados en Firestore:', err.code || err.message);
    }
  }

  // ---- Sincronizar TODO desde Firestore al iniciar sesión ----
  // Se llama desde firebase-auth.js después de autenticar
  window._sincronizarProgresoDesdeFirestore = async function(uid) {
    if (!uid) return;
    // Esperar a que _firestoreDB esté disponible (puede tardar un tick)
    let intentos = 0;
    while (!_firestoreDB && intentos < 30) {
      await new Promise(r => setTimeout(r, 200));
      intentos++;
    }
    if (!_firestoreDB) {
      console.warn('[IAR Sync] No se pudo obtener la instancia de Firestore para sincronización');
      return;
    }
    _firestoreUID = uid;
    _sincronizandoDesdeFS = true; // suprimir re-escritura en Firestore durante la carga

    // CRÍTICO: limpiar historial local ANTES de cargar el de Firestore.
    // Sin esto, un usuario nuevo ve el historial del usuario anterior
    // que quedó en localStorage del mismo navegador.
    attemptLog = [];
    localStorage.removeItem(ATTEMPT_LOG_KEY);
    console.log('[IAR Sync] 🧹 Historial local limpiado antes de cargar desde Firestore (uid:', uid, ')');

    try {
      const { doc, getDoc, collection, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");

      // ─────────────────────────────────────────────────────────────────────────
      // REGLA FUNDAMENTAL: Firestore es la fuente de verdad para TODO el progreso.
      // Al iniciar sesión, el estado de Firestore REEMPLAZA al localStorage
      // para cada sección que exista en Firestore.
      // El localStorage es solo caché de sesión — nunca puede ganarle a Firestore.
      // ─────────────────────────────────────────────────────────────────────────

      // --- 1. Cargar estado de TODAS las secciones desde Firestore ---
      // Firestore reemplaza incondicionalmente el estado local de cada sección.
      // Si una sección no existe en Firestore, se conserva el estado local.
      try {
        const seccionesCol = collection(_firestoreDB, 'progreso', uid, 'secciones');
        const secSnap = await getDocs(seccionesCol);
        let seccionesActualizadas = 0;

        secSnap.forEach(docSnap => {
          const seccionId = docSnap.id;
          const data = docSnap.data();
          delete data._ts; // quitar campo técnico interno

          // ── Simulacro IAR: NUNCA restaurar progreso incompleto desde Firestore ──
          // El simulacro es efímero: si el usuario cerró sesión/recargó con progreso a medias,
          // ese progreso se descarta. Solo se restaura si estaba completamente terminado (totalShown).
          if (seccionId === 'simulacro_iar' && !data.totalShown) {
            console.log('[IAR Sync] ⏭️ simulacro_iar incompleto en Firestore — ignorado (se generará nuevo set)');
            // También borrar de Firestore para no acumular datos obsoletos
            _borrarSeccionFirestore('simulacro_iar');
            return; // skip this section
          }

          const fsGradedCount = data.graded
            ? Object.keys(data.graded).filter(k => data.graded[k]).length
            : 0;
          const fsHayAnswers = data.answers && Object.keys(data.answers).some(k => {
            const a = data.answers[k]; return Array.isArray(a) && a.length > 0;
          });

          // Contar progreso local para logging
          const localData = state[seccionId];
          const localGradedCount = localData && localData.graded
            ? Object.keys(localData.graded).filter(k => localData.graded[k]).length
            : 0;

          if (fsGradedCount > 0 || fsHayAnswers || data.totalShown) {
            // Firestore tiene progreso real → reemplazar local incondicionalmente
            state[seccionId] = data;
            seccionesActualizadas++;
            if (fsGradedCount !== localGradedCount) {
              console.log('[IAR Sync] ✅ Sección actualizada desde Firestore:', seccionId,
                '| FS:', fsGradedCount, 'resp | Local previo:', localGradedCount, 'resp');
            }
          } else if (localGradedCount > 0) {
            // Firestore está vacío pero local tiene datos → subir local a Firestore
            console.log('[IAR Sync] ⬆️ Subiendo progreso local a Firestore (FS vacío):', seccionId);
            _guardarSeccionFirestore(seccionId);
          }
        });

        // Para secciones que están en local pero NO en Firestore:
        // subir esos datos a Firestore (por si se respondieron sin conexión o antes de la sincronización)
        Object.keys(state).forEach(function(seccionId) {
          // Nunca subir a Firestore el simulacro_iar si está incompleto
          if (seccionId === 'simulacro_iar') {
            const s = state[seccionId];
            if (!s || !s.totalShown) return; // skip
          }
          // Verificar si esta sección ya fue procesada desde Firestore
          let yaEnFS = false;
          secSnap.forEach(docSnap => { if (docSnap.id === seccionId) yaEnFS = true; });
          if (!yaEnFS) {
            const s = state[seccionId];
            const hayGraded = s && s.graded && Object.keys(s.graded).some(k => s.graded[k]);
            const hayAnswers = s && s.answers && Object.keys(s.answers).some(k => {
              const a = s.answers[k]; return Array.isArray(a) && a.length > 0;
            });
            if (hayGraded || hayAnswers || (s && s.totalShown)) {
              console.log('[IAR Sync] ⬆️ Sección local no encontrada en Firestore, subiendo:', seccionId);
              _guardarSeccionFirestore(seccionId);
            }
          }
        });

        // Actualizar localStorage con el estado fusionado
        saveJSON(STORAGE_KEY, state);
        console.log('[IAR Sync] ✅ Sincronización completada. Secciones actualizadas desde Firestore:', seccionesActualizadas);
      } catch(e) {
        console.warn('[IAR Sync] No se pudo cargar secciones desde Firestore:', e.code || e.message);
      }

      // --- 2. Cargar historial (Firestore siempre es la fuente de verdad) ---
      try {
        const histRef = doc(_firestoreDB, 'progreso', uid, 'datos', 'historial');
        const histSnap = await getDoc(histRef);
        if (histSnap.exists() && histSnap.data().entries) {
          const fsEntries = histSnap.data().entries;
          // Firestore gana si tiene más entradas o igual cantidad
          // Solo se conserva local si Firestore está vacío y local tiene datos
          if (fsEntries.length >= attemptLog.length) {
            attemptLog = fsEntries;
            saveJSON(ATTEMPT_LOG_KEY, attemptLog);
            console.log('[IAR Sync] ✅ Historial cargado desde Firestore:', fsEntries.length, 'entradas');
          } else if (attemptLog.length > 0) {
            // Local tiene más entradas → subir a Firestore
            console.log('[IAR Sync] ⬆️ Historial local tiene más entradas, subiendo a Firestore');
            _guardarHistorialFirestore();
          }
        } else if (attemptLog.length > 0) {
          // Firestore no tiene historial pero local sí → subir
          console.log('[IAR Sync] ⬆️ Subiendo historial local a Firestore (FS sin historial)');
          _guardarHistorialFirestore();
        }
      } catch(e) {
        console.warn('[IAR Sync] No se pudo cargar historial desde Firestore:', e.code || e.message);
      }

      // --- 3. Cargar completados (Firestore es la fuente de verdad, fusionar con local) ---
      try {
        const compRef = doc(_firestoreDB, 'progreso', uid, 'datos', 'completados');
        const compSnap = await getDoc(compRef);
        const USER_KEY = 'iar_user_id_v1';
        const COMPLETED_KEY_PREFIX = 'iar_completed_v1_';
        const localUid = localStorage.getItem(USER_KEY);

        if (compSnap.exists() && compSnap.data().completados) {
          const fsCompleted = compSnap.data().completados;
          if (localUid) {
            const completedKey = COMPLETED_KEY_PREFIX + localUid;
            let localCompleted = {};
            try { localCompleted = JSON.parse(localStorage.getItem(completedKey) || '{}'); } catch(e2) {}
            // Fusión: Firestore tiene prioridad, se agregan los locales que no estén en FS
            const merged = { ...localCompleted, ...fsCompleted };
            localStorage.setItem(completedKey, JSON.stringify(merged));
            // Si local tenía algo que FS no tiene, subir la fusión a Firestore
            const localTieneExtra = Object.keys(localCompleted).some(k => !fsCompleted[k]);
            if (localTieneExtra) {
              _guardarCompletadosFirestore(merged);
            }
          }
          console.log('[IAR Sync] ✅ Completados cargados desde Firestore');
        } else if (localUid) {
          // Firestore no tiene completados → subir los locales si existen
          const completedKey = COMPLETED_KEY_PREFIX + localUid;
          let localCompleted = {};
          try { localCompleted = JSON.parse(localStorage.getItem(completedKey) || '{}'); } catch(e2) {}
          if (Object.keys(localCompleted).length > 0) {
            console.log('[IAR Sync] ⬆️ Subiendo completados locales a Firestore');
            _guardarCompletadosFirestore(localCompleted);
          }
        }
        // Actualizar UI de checkmarks
        if (typeof renderNavBar === 'function') renderNavBar();
        _actualizarCheckmarksMenu();
      } catch(e) {
        console.warn('[IAR Sync] No se pudo cargar completados desde Firestore:', e.code || e.message);
      }

    } catch(err) {
      console.warn('[IAR Sync] Error general en sincronización desde Firestore:', err.code || err.message);
    } finally {
      _sincronizandoDesdeFS = false; // restaurar flag sea cual sea el resultado
    }
  };

  // ---- Actualizar checkmarks en el menú ----
  function _actualizarCheckmarksMenu() {
    try {
      const USER_KEY = 'iar_user_id_v1';
      const COMPLETED_KEY_PREFIX = 'iar_completed_v1_';
      const uid = localStorage.getItem(USER_KEY);
      if (!uid) return;
      const completedKey = COMPLETED_KEY_PREFIX + uid;
      const completed = JSON.parse(localStorage.getItem(completedKey) || '{}');
      document.querySelectorAll('li[onclick]').forEach(function(li) {
        const m = li.getAttribute('onclick').match(/mostrarCuestionario\('([^']+)'\)/);
        if (m && completed[m[1]]) {
          li.classList.add('iar-completado');
          const inp = li.querySelector('.iar-check-input');
          if (inp) {
            inp.checked = true;
            const icon = li.querySelector('.iar-check-icon');
            if (icon) icon.title = 'Completado — clic para desmarcar';
          }
        }
      });
    } catch(e) {}
  }

  // ---- Exponer UID de Firebase para que firebase-auth.js lo use ----
  // (se llama desde firebase-auth.js pasando db y uid)
  // END OF FIRESTORE SYNC MODULE

  // ======== MANEJO DE NAVEGACIÓN DEL NAVEGADOR ========
  let currentSection = null;

  // ======== Utilidades ========
  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  let _sincronizandoDesdeFS = false; // flag para evitar re-subir a FS durante la carga inicial

  function saveJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    // ── Firestore sync ──
    // No disparar guardado en Firestore si estamos en medio de una sincronización
    // desde Firestore (evita loop y escrituras innecesarias)
    if (key === STORAGE_KEY && !_sincronizandoDesdeFS) {
      // Guardar cada sección que tenga progreso real
      const stateObj = value;
      Object.keys(stateObj).forEach(function(seccionId) {
        // Simulacro IAR incompleto: NUNCA subir a Firestore (es efímero)
        if (seccionId === 'simulacro_iar') {
          const s = stateObj[seccionId];
          if (!s || !s.totalShown) return; // skip — solo subir si está completado
        }
        const s = stateObj[seccionId];
        const hayGraded = s && s.graded && Object.keys(s.graded).some(function(k){ return s.graded[k]; });
        const hayAnswers = s && s.answers && Object.keys(s.answers).some(function(k){
          var a = s.answers[k]; return Array.isArray(a) && a.length > 0;
        });
        if (hayGraded || hayAnswers || (s && s.totalShown)) {
          _guardarSeccionFirestore(seccionId);
        }
      });
    }
  }
  function cap(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : "";
  }
  function todayISO() {
    return new Date().toISOString();
  }
  function toLocalDateStr(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString();
  }

  // ======== Scroll inteligente: guardar el cuestionario de origen para volver a él ========
  const LAST_SECTION_KEY = "quiz_last_section_v1";

  function saveLastSection(seccionId) {
    localStorage.setItem(LAST_SECTION_KEY, seccionId);
    // También guardar la posición del scroll del menú/submenú actual (como fallback)
    const scrollPosition = window.pageYOffset || document.documentElement.scrollTop;
    localStorage.setItem(SCROLL_POSITION_KEY, scrollPosition.toString());
  }

  function scrollToSectionItem(seccionId) {
    if (!seccionId) {
      // Fallback: restaurar posición guardada
      const savedPosition = localStorage.getItem(SCROLL_POSITION_KEY);
      if (savedPosition) {
        requestAnimationFrame(() => {
          window.scrollTo({ top: parseInt(savedPosition, 10), behavior: 'smooth' });
        });
      }
      return;
    }

    // Buscar el <li> que lanza este cuestionario en el menú o submenú visible
    requestAnimationFrame(() => {
      // Esperar un frame extra para que el menú/submenú esté visible
      requestAnimationFrame(() => {
        const allLis = document.querySelectorAll('li[onclick]');
        let targetLi = null;
        for (const li of allLis) {
          const onclick = li.getAttribute('onclick') || '';
          if (onclick.includes(`'${seccionId}'`) || onclick.includes(`"${seccionId}"`)) {
            targetLi = li;
            break;
          }
        }
        if (targetLi) {
          targetLi.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Resaltar brevemente el ítem
          const originalBg = targetLi.style.backgroundColor;
          const originalTransition = targetLi.style.transition;
          targetLi.style.transition = 'background-color 0.15s ease';
          targetLi.style.backgroundColor = 'rgba(255, 220, 80, 0.55)';
          setTimeout(() => {
            targetLi.style.backgroundColor = originalBg || '';
            setTimeout(() => {
              targetLi.style.transition = originalTransition || '';
            }, 600);
          }, 900);
        } else {
          // Si no se encuentra el li (ej: submenú dentro de submenú), fallback a posición guardada
          const savedPosition = localStorage.getItem(SCROLL_POSITION_KEY);
          if (savedPosition) {
            window.scrollTo({ top: parseInt(savedPosition, 10), behavior: 'smooth' });
          }
        }
        localStorage.removeItem(LAST_SECTION_KEY);
      });
    });
  }

  function saveScrollPosition() {
    const scrollPosition = window.pageYOffset || document.documentElement.scrollTop;
    localStorage.setItem(SCROLL_POSITION_KEY, scrollPosition.toString());
  }

  function restoreScrollPosition() {
    const lastSection = localStorage.getItem(LAST_SECTION_KEY);
    scrollToSectionItem(lastSection);
  }

  function clearScrollPosition() {
    localStorage.removeItem(SCROLL_POSITION_KEY);
    localStorage.removeItem(LAST_SECTION_KEY);
  }

  // ======== Función para manejar el historial del navegador ========
  function setupBrowserNavigation() {
    window.addEventListener('popstate', function(event) {
      // Ocultar panel de respuestas si estaba visible
      const _prc2 = document.getElementById('panel-respuestas-correctas');
      if (_prc2 && !_prc2.classList.contains('oculto')) _prc2.classList.add('oculto');
      const _pre3 = document.getElementById('pagina-respuestas-examen');
      if (_pre3) _pre3.classList.remove('activa');

      // Si es un estado de respuestas de examen individual, mostrar submenú
      if (event.state && event.state.respuestasExamen) {
        mostrarRespuestasExamen(event.state.respuestasExamen);
        return;
      }
      // Si es el submenú de respuestas
      if (event.state && event.state.respuestas) {
        mostrarRespuestasCorrectas();
        return;
      }

      // Detectar si veníamos del buscador
      const desdeBuscador = (typeof navegacionOrigen !== 'undefined' && navegacionOrigen === 'buscador') ||
                            (function(){ try { return sessionStorage.getItem('buscador_origen') === '1'; } catch(e){ return false; }})();

      if (event.state && event.state.section) {
        showSection(event.state.section);
      } else if (event.state && event.state.submenu) {
        // Si venimos del buscador, volver al buscador
        if (desdeBuscador) {
          window.volverAlBuscador && window.volverAlBuscador();
          return;
        }
        const submenuId = event.state.submenu;
        const lastSec = localStorage.getItem(LAST_SECTION_KEY);
        currentSection = null;
        document.getElementById("menu-principal")?.classList.add("oculto");
        document.querySelectorAll(".menu-principal[id$='-submenu']").forEach(s => s.style.display = "none");
        document.querySelectorAll(".pagina-cuestionario").forEach(p => p.classList.remove("activa"));
        const submenu = document.getElementById(submenuId);
        if (submenu) submenu.style.display = "block";
        scrollToSectionItem(lastSec);
      } else {
        // Si venimos del buscador, volver al buscador
        if (desdeBuscador) {
          window.volverAlBuscador && window.volverAlBuscador();
          return;
        }
        showMenu();
      }
    });
    
    if (window.location.hash === '' || window.location.hash === '#menu') {
      history.replaceState({ section: null }, 'Menú Principal', '#menu');
    }
  }

  // ======== Cargar estado de una sección desde Firestore si no existe en local ========
  // ======== Cargar estado de una sección desde Firestore (FIRESTORE ES LA FUENTE DE VERDAD) ========
  // Firestore siempre tiene prioridad sobre localStorage si tiene más respuestas calificadas,
  // o si el cuestionario ya fue completado (totalShown). Esto permite sincronizar entre dispositivos.
  function _cargarEstadoSeccionDesdeFS(seccionId, callback) {
    // Si no hay Firestore disponible, usar estado local
    if (!_firestoreUID || !_firestoreDB) {
      if (typeof callback === 'function') callback();
      return;
    }

    // Contar respuestas calificadas locales para comparar con Firestore
    const localState = state[seccionId];
    const localGradedCount = localState && localState.graded
      ? Object.keys(localState.graded).filter(function(k){ return localState.graded[k]; }).length
      : 0;

    // Cargar desde Firestore y comparar — Firestore es la fuente de verdad
    _sincronizandoDesdeFS = true;
    import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js").then(function(fsModule) {
      const docRef = fsModule.doc(_firestoreDB, 'progreso', _firestoreUID, 'secciones', seccionId);
      return fsModule.getDoc(docRef);
    }).then(function(snap) {
      if (snap && snap.exists()) {
        const data = snap.data();
        delete data._ts;
        const fsGradedCount = data.graded
          ? Object.keys(data.graded).filter(function(k){ return data.graded[k]; }).length
          : 0;
        const fsHayAnswers = data.answers && Object.keys(data.answers).some(function(k){
          var a = data.answers[k]; return Array.isArray(a) && a.length > 0;
        });

        // Firestore gana si: tiene más respuestas calificadas, o tiene totalShown,
        // o local está vacío pero Firestore tiene algo
        if (fsGradedCount > localGradedCount || data.totalShown || (fsHayAnswers && localGradedCount === 0)) {
          state[seccionId] = data;
          saveJSON(STORAGE_KEY, state);
          console.log('[IAR Sync] ✅ Firestore tiene más progreso (' + fsGradedCount + ' vs ' + localGradedCount + ') — cargado:', seccionId);
        } else if (localGradedCount > 0) {
          // Local tiene igual o más progreso — conservar local pero guardar en Firestore
          console.log('[IAR Sync] ℹ️ Local tiene progreso igual/mayor (' + localGradedCount + ' vs ' + fsGradedCount + ') — usando local y sincronizando:', seccionId);
          _guardarSeccionFirestore(seccionId);
        }
      } else if (localGradedCount > 0) {
        // No hay nada en Firestore pero sí local — subir a Firestore
        console.log('[IAR Sync] ℹ️ Subiendo progreso local a Firestore (no existía en nube):', seccionId);
        _guardarSeccionFirestore(seccionId);
      }
      _sincronizandoDesdeFS = false;
      if (typeof callback === 'function') callback();
    }).catch(function(err) {
      console.warn('[IAR Sync] No se pudo cargar estado de sección desde Firestore:', seccionId, err.code || err.message);
      _sincronizandoDesdeFS = false;
      if (typeof callback === 'function') callback();
    });
  }

  function showSection(seccionId) {
    // ── BLOQUEO DEMO ──
    // Caso 1: licencia ya verificada → bloquear inmediatamente
    if (window._demoCheckEnabled && window._demoSeccionesPermitidas) {
      const esPermitida = window._demoSeccionesPermitidas.includes(seccionId);
      const esSimulacro = seccionId === 'simulacro_iar';
      if (!esPermitida || esSimulacro) {
        if (typeof mostrarModalRestriccionDemo === 'function') mostrarModalRestriccionDemo();
        return;
      }
    }
    // Caso 2: simulacro pedido ANTES de que la licencia esté verificada (F5 rápido)
    // Usar _licenciaYaVerificada (true para cualquier usuario) para evitar loop.
    if (seccionId === 'simulacro_iar' && !window._licenciaYaVerificada) {
      if (window._licenciaVerificada) {
        window._licenciaVerificada.then(function(lic) {
          if (!lic.esDemo) showSection(seccionId);
          else if (typeof mostrarModalRestriccionDemo === 'function') mostrarModalRestriccionDemo();
        });
        return;
      }
    }
    currentSection = seccionId;
    // Ocultar botón flotante en páginas de cuestionario
    const _btnFloat = document.getElementById("btn-ver-progreso");
    if (_btnFloat) _btnFloat.style.display = "none";
    const _panelFloat = document.getElementById("panel-progreso");
    if (_panelFloat) _panelFloat.style.display = "none";
    document.getElementById("menu-principal")?.classList.add("oculto");
    const _pb = document.getElementById('buscador-preguntas');
    if (_pb) _pb.classList.add('oculto');
    document.querySelectorAll(".menu-principal[id$='-submenu']").forEach(s => s.style.display = "none");
    document.querySelectorAll(".pagina-cuestionario").forEach(p => p.classList.remove("activa"));

    navBarModo = 'normal';
    renderNavBar();

    const page = document.getElementById(seccionId);
    if (!page) return;
    page.classList.add("activa");
    window.scrollTo(0, 0);

    // Simulacro IAR: SIEMPRE pasar por inicializarSimulacroIAR (maneja progreso y nuevo)
    if (seccionId === 'simulacro_iar') {
      window.inicializarSimulacroIAR && window.inicializarSimulacroIAR();
      return;
    }

    // Si las preguntas ya están en memoria, generar directamente
    if (preguntasPorSeccion[seccionId]) {
      // Cargar estado desde Firestore si no hay estado local para esta sección
      _cargarEstadoSeccionDesdeFS(seccionId, function() {
        const _cb = window._buscadorPendienteScroll || null;
        window._buscadorPendienteScroll = null;
        generarCuestionario(seccionId, _cb);

      });
      return;
    }

    // Si no están en memoria, mostrar loading y cargar desde Firestore.
    // firebase-auth.js es type="module" y se ejecuta DESPUÉS de script.js,
    // por eso usamos polling hasta que window.cargarSeccionFirestore esté disponible.
    const cont = document.getElementById(`cuestionario-${seccionId}`);
    if (cont) {
      cont.innerHTML = `
        <div style="text-align:center;padding:60px 20px;color:#64748b;">
          <div style="font-size:2rem;margin-bottom:12px;">⏳</div>
          <div style="font-size:1rem;font-weight:600;">Cargando cuestionario...</div>
        </div>`;
    }

    function _cargarConFirestore(intentos) {
      if (currentSection !== seccionId) return;
      console.log('[IAR DEBUG] intento=' + intentos + ' cargarSeccionFirestore=' + typeof window.cargarSeccionFirestore + ' seccion=' + seccionId);
      if (window.cargarSeccionFirestore) {
        window.cargarSeccionFirestore(seccionId).then(function(preguntas) {
          console.log('[IAR DEBUG] Firestore respondió. preguntas=' + (preguntas ? preguntas.length : 'null') + ' seccion=' + seccionId);
          if (preguntas) preguntasPorSeccion[seccionId] = preguntas;
          if (currentSection === seccionId) {
            // Cargar estado desde Firestore si no hay estado local para esta sección
            _cargarEstadoSeccionDesdeFS(seccionId, function() {
              const _cb = window._buscadorPendienteScroll || null;
              window._buscadorPendienteScroll = null;
              generarCuestionario(seccionId, _cb);

            });
          }
        }).catch(function(err) {
          console.error('Error cargando sección:', err);
          if (cont && currentSection === seccionId) {
            cont.innerHTML = `
              <div style="text-align:center;padding:60px 20px;color:#dc2626;">
                <div style="font-size:2rem;margin-bottom:12px;">⚠️</div>
                <div style="font-size:1rem;font-weight:600;">Error al cargar el cuestionario.</div>
                <div style="font-size:.88rem;margin-top:8px;">Verificá tu conexión e intentá nuevamente.</div>
              </div>`;
          }
        });
      } else if (intentos < 20) {
        setTimeout(function() { _cargarConFirestore(intentos + 1); }, 200);
      } else {
        console.error('[IAR DEBUG] TIMEOUT: cargarSeccionFirestore nunca estuvo disponible');
        if (cont && currentSection === seccionId) {
          cont.innerHTML = `
            <div style="text-align:center;padding:60px 20px;color:#dc2626;">
              <div style="font-size:2rem;margin-bottom:12px;">⚠️</div>
              <div style="font-size:1rem;font-weight:600;">No se pudo conectar con la base de datos.</div>
              <div style="font-size:.88rem;margin-top:8px;">Recargá la página e intentá nuevamente.</div>
            </div>`;
        }
      }
    }
    _cargarConFirestore(0);
  }

  function showMenu() {
    // Mostrar botón flotante solo en menú principal
    const _btnFloat = document.getElementById("btn-ver-progreso");
    if (_btnFloat) _btnFloat.style.display = "";
    // Cerrar panel de progreso si estaba abierto
    const _panelFloat = document.getElementById("panel-progreso");
    if (_panelFloat) _panelFloat.style.display = "none";



    // Simulacro IAR: al salir al menú SIEMPRE limpiar el progreso (no se guarda)
    // Excepción: si ya completó el cuestionario (totalShown), no limpiar para que vea el resultado
    if (currentSection === 'simulacro_iar') {
      var _simStateRaw = null;
      try { _simStateRaw = JSON.parse(localStorage.getItem('quiz_state_v3') || '{}')['simulacro_iar']; } catch(e) {}
      var _simCompleto = _simStateRaw && _simStateRaw.totalShown;
      if (!_simCompleto) {
        // Progreso incompleto → limpiar todo (no persistir)
        _limpiarSimulacroIARSinProgreso();
      }
      // Si está completo, no limpiar — el usuario puede ver su resultado
      // Early return — simulacro_iar no necesita el bloque general
      currentSection = null;
      document.querySelectorAll(".menu-principal[id$='-submenu']").forEach(s => s.style.display = "none");
      document.querySelectorAll(".pagina-cuestionario").forEach(p => p.classList.remove("activa"));
      const _pbSim = document.getElementById('buscador-preguntas');
      if (_pbSim) _pbSim.classList.add('oculto');
      const _bfSim = document.getElementById('btn-volver-buscador');
      if (_bfSim) _bfSim.style.display = 'none';
      try { sessionStorage.removeItem('buscador_origen'); } catch(e) {}
      try { localStorage.removeItem('buscador_ultimo_query_v1'); } catch(e) {}
      const _inpSim = document.getElementById('buscador-input');
      if (_inpSim) _inpSim.value = '';
      const _resSim = document.getElementById('buscador-resultados');
      if (_resSim) _resSim.innerHTML = '';
      const _stSim = document.getElementById('buscador-stats');
      if (_stSim) _stSim.style.display = 'none';
      document.getElementById("menu-principal")?.classList.remove("oculto");
      restoreScrollPosition();
      return;
    }
    
    if (currentSection && preguntasPorSeccion[currentSection]) {
      // Limpiar el estado completamente si se completó el cuestionario
      clearSectionStateIfCompletedAndBack(currentSection);
      
      if (state[currentSection] && !state[currentSection].totalShown) {


        // IMPORTANTE: leer progreso desde localStorage, no desde state en memoria,
        // porque script_onebyone.js escribe directamente en quiz_state_v3 sin actualizar state.
        const hayProgreso = _hayProgresoEnStorage(currentSection);

        if (hayProgreso) {
          // Sincronizar state en memoria con localStorage antes de continuar
          _sincronizarStateDesdeStorage(currentSection);
          // Persistir el indice OAV actual para restaurar la posicion al volver
          _persistirIndiceOAVActual(currentSection);
          console.log('Volvio con progreso → estado conservado');
        } else {
          limpiarSeccion(currentSection, true);
          console.log('Volvio sin progreso → opciones re-aleatorizadas');
        }
      }
    }
    
    currentSection = null;
    document.querySelectorAll(".menu-principal[id$='-submenu']").forEach(s => s.style.display = "none");
    document.querySelectorAll(".pagina-cuestionario").forEach(p => p.classList.remove("activa"));

    // Ocultar panel del buscador y limpiar búsqueda
    const _pb = document.getElementById('buscador-preguntas');
    if (_pb) _pb.classList.add('oculto');
    const _bf = document.getElementById('btn-volver-buscador');
    if (_bf) _bf.style.display = 'none';
    try { sessionStorage.removeItem('buscador_origen'); } catch(e) {}
    try { localStorage.removeItem('buscador_ultimo_query_v1'); } catch(e) {}
    // Limpiar visualmente el buscador
    const _inp = document.getElementById('buscador-input');
    if (_inp) _inp.value = '';
    const _res = document.getElementById('buscador-resultados');
    if (_res) _res.innerHTML = '';
    const _st = document.getElementById('buscador-stats');
    if (_st) _st.style.display = 'none';

    // Mostrar menú principal
    document.getElementById("menu-principal")?.classList.remove("oculto");

    // Siempre actualizar el hash a #menu al volver al menú principal
    if (window.location.hash !== '#menu') {
      history.replaceState({ section: null }, 'Menú Principal', '#menu');
    }

    restoreScrollPosition();
  }

  let lastShuffleTemp = {};

  // ======== Helper: limpiar índice de navegación OAV del localStorage ========
  function _limpiarOAVIdx(seccionId) {
    try {
      var raw = localStorage.getItem('oav_current_idx_v1');
      if (!raw) return;
      var all = JSON.parse(raw);
      delete all[seccionId];
      localStorage.setItem('oav_current_idx_v1', JSON.stringify(all));
    } catch(e) {}
  }


  // ======== Helper: leer si una sección tiene progreso en localStorage ========
  // IMPORTANTE: script_onebyone.js escribe en quiz_state_v3 directamente
  // sin actualizar el objeto `state` en memoria. Por eso hay que leer desde localStorage.
  function _hayProgresoEnStorage(seccionId) {
    if (!seccionId) return false;
    try {
      var raw = localStorage.getItem('quiz_state_v3');
      if (!raw) return false;
      var all = JSON.parse(raw);
      var s = all[seccionId];
      if (!s) return false;
      // Si totalShown=true y NO hay graded ni answers, no hay progreso real
      // (estado huérfano tras completar y volver)
      var hayGraded = s.graded && Object.keys(s.graded).some(function(k){ return s.graded[k]; });
      if (hayGraded) return true;
      var hayAnswers = s.answers && Object.keys(s.answers).some(function(k){
        var a = s.answers[k]; return Array.isArray(a) && a.length > 0;
      });
      return !!hayAnswers;
    } catch(e) { return false; }
  }

  // ======== Helper: sincronizar state en memoria desde localStorage ========
  // Necesario porque script_onebyone.js escribe en localStorage sin pasar por state en memoria.
  function _sincronizarStateDesdeStorage(seccionId) {
    try {
      var raw = localStorage.getItem('quiz_state_v3');
      if (!raw) return;
      var all = JSON.parse(raw);
      if (all[seccionId]) {
        state[seccionId] = all[seccionId];
      }
    } catch(e) {}
  }


  // ======== Helper: persistir índice OAV actual en localStorage al salir con progreso ========
  function _persistirIndiceOAVActual(seccionId) {
    if (!seccionId) return;
    try {
      var idx = null;
      if (window._oavGetCurrentIdx) {
        idx = window._oavGetCurrentIdx(seccionId);
      } else if (window._oavState && window._oavState[seccionId] != null) {
        idx = window._oavState[seccionId].currentIdx;
      }
      if (idx == null || typeof idx !== 'number') return;
      var all = JSON.parse(localStorage.getItem('oav_current_idx_v1') || '{}');
      all[seccionId] = idx;
      localStorage.setItem('oav_current_idx_v1', JSON.stringify(all));
    } catch(e) {}
  }

  // ======== Helper: limpiar sección con o sin aleatorización de opciones ========
  // aleatorizar=true  → borra shuffleMap → las opciones se re-mezclan al regenerar
  // aleatorizar=false → conserva shuffleMap → las opciones mantienen el orden previo
  function limpiarSeccion(seccionId, aleatorizar) {
    const s = state[seccionId];
    _limpiarOAVIdx(seccionId);

    if (aleatorizar) {
      // Borrar completamente → nueva aleatorización de preguntas y opciones al regenerar
      delete state[seccionId];
    } else {
      // Conservar shuffleMap (orden de opciones) y unansweredOrder (orden de preguntas)
      const shuffleMapGuardado = (s && s.shuffleMap)
        ? JSON.parse(JSON.stringify(s.shuffleMap))
        : {};
      const answeredOrderGuardado = s && s.answeredOrder ? s.answeredOrder.slice() : [];
      const unansweredOrderGuardado = s && s.unansweredOrder ? s.unansweredOrder.slice() : [];

      state[seccionId] = {
        shuffleFrozen: true,
        shuffleMap: shuffleMapGuardado,
        answeredOrder: [],
        // Restaurar todas las preguntas al orden no-respondido, preservando su secuencia
        unansweredOrder: [...answeredOrderGuardado, ...unansweredOrderGuardado],
        answers: {},
        graded: {},
        totalShown: false,
        explanationShown: {}
      };
    }

    saveJSON(STORAGE_KEY, state);
    // Borrar también en Firestore para que al volver no se restaure el progreso viejo
    _borrarSeccionFirestore(seccionId);

    if (window.puntajesPorSeccion && window.puntajesPorSeccion[seccionId]) {
      window.puntajesPorSeccion[seccionId] = Array(
        (preguntasPorSeccion[seccionId] || []).length
      ).fill(null);
    }

    const resultadoTotal = document.getElementById(`resultado-total-${seccionId}`);
    if (resultadoTotal) {
      resultadoTotal.innerHTML = "";
      resultadoTotal.className = "resultado-final";
    }
  }

  function shuffle(arr, qKey = null) {
    const a = arr.slice();

    let seed = Date.now();
    function random() {
      seed ^= seed << 13;
      seed ^= seed >> 17;
      seed ^= seed << 5;
      return Math.abs(seed) / 0xFFFFFFFF;
    }

    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }

    if (qKey) {
      const prev = lastShuffleTemp[qKey];
      let attempts = 0;
      while (prev && JSON.stringify(prev) === JSON.stringify(a) && attempts < 10) {
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(random() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        attempts++;
      }
      lastShuffleTemp[qKey] = a.slice();
    }

    return a;
  }

  function ensureSectionState(seccionId, preguntasLen) {
    if (!state[seccionId]) {
      console.log('🆕 Inicializando estado para:', seccionId);
      state[seccionId] = {
        shuffleFrozen: false,
        shuffleMap: {},
        answeredOrder: [], // Solo guardamos el orden de las respondidas
        unansweredOrder: [], // Orden aleatorizado de las sin responder (se mantiene durante la sesión)
        answers: {},
        graded: {},
        totalShown: false,
        explanationShown: {}  // tracking de explicaciones mostradas
      };
    }
    
    // Asegurar que exista unansweredOrder si no está (compatibilidad con estados antiguos)
    if (!state[seccionId].unansweredOrder) {
      state[seccionId].unansweredOrder = [];
    }
    
    if (!window.puntajesPorSeccion) window.puntajesPorSeccion = {};
    if (!window.puntajesPorSeccion[seccionId]) {
      window.puntajesPorSeccion[seccionId] = Array(preguntasLen).fill(null);
    }
  }

  function getSectionTitle(seccionId) {
    const page = document.getElementById(seccionId);
    if (!page) return cap(seccionId);
    const h1 = page.querySelector("h1, h2, .titulo-seccion");
    return (h1 && h1.textContent.trim()) || cap(seccionId);
  }

  // Devuelve mapping inverso mezclado -> original y opciones mezcladas
  function getOrBuildShuffleForQuestion(seccionId, qIndex, opciones) {
    const s = state[seccionId];
    if (s.shuffleMap[qIndex]) {
      const inv = s.shuffleMap[qIndex];
      const opcionesMezcladas = [];
      Object.keys(inv).forEach(mixed => {
        const original = inv[mixed];
        opcionesMezcladas[mixed] = opciones[original];
      });
      return { inv, opcionesMezcladas };
    }
    
    const indices = opciones.map((_, i) => i);
    const shuffled = shuffle(indices, seccionId + "-" + qIndex);
    const inv = {};
    shuffled.forEach((origIdx, mixedIdx) => {
      inv[mixedIdx] = origIdx;
    });
    const opcionesMezcladas = shuffled.map(i => opciones[i]);
    return { inv, opcionesMezcladas };
  }

  // Congela el shuffle de las opciones de UNA pregunta específica
  function freezeShuffleForQuestion(seccionId, qIndex) {
    const s = state[seccionId];
    const cont = document.getElementById(`cuestionario-${seccionId}`);
    if (!cont) return;

    // Solo congelar esta pregunta específica
    const inputs = cont.querySelectorAll(`input[name="pregunta${seccionId}${qIndex}"]`);
    const inv = {};
    inputs.forEach((input, mixedIdx) => {
      const original = parseInt(input.getAttribute("data-original-index"), 10);
      inv[mixedIdx] = isNaN(original) ? mixedIdx : original;
    });
    s.shuffleMap[qIndex] = inv;
    console.log('🔒 Opciones congeladas para pregunta', qIndex, ':', inv);
    saveJSON(STORAGE_KEY, state);
  }

  // Función legacy mantenida por compatibilidad
  function freezeCurrentShuffle(seccionId) {
    // Ya no congela todas, solo marca como congelado
    const s = state[seccionId];
    s.shuffleFrozen = true;
    saveJSON(STORAGE_KEY, state);
  }

  function clearSectionStateIfCompletedAndBack(seccionId) {
    const s = state[seccionId];
    if (!s) return;
    if (s.totalShown) {
      delete state[seccionId];
      saveJSON(STORAGE_KEY, state);
      if (window.puntajesPorSeccion && window.puntajesPorSeccion[seccionId]) {
        window.puntajesPorSeccion[seccionId] = Array(
          (preguntasPorSeccion[seccionId] || []).length
        ).fill(null);
      }
      const resultadoTotal = document.getElementById(`resultado-total-${seccionId}`);
      if (resultadoTotal) {
        resultadoTotal.textContent = "";
        resultadoTotal.className = "resultado-final";
      }
    }
  }

  // ======== Función para mostrar/ocultar explicación ========
  function mostrarExplicacion(seccionId, qIndex) {
    // Solo permitir ver la explicación si ya se respondió la pregunta
    if (!state[seccionId].graded || !state[seccionId].graded[qIndex]) {
      alert("Debes responder la pregunta primero para ver la explicación.");
      return;
    }

    const explicacionDiv = document.getElementById(`explicacion-${seccionId}-${qIndex}`);
    const btnExplicacion = document.getElementById(`btn-explicacion-${seccionId}-${qIndex}`);
    
    if (explicacionDiv.style.display === "none" || explicacionDiv.style.display === "") {
      // Mostrar explicación
      explicacionDiv.style.display = "block";
      btnExplicacion.textContent = "Ocultar explicación";
      
      // Marcar como mostrada
      if (!state[seccionId].explanationShown) state[seccionId].explanationShown = {};
      state[seccionId].explanationShown[qIndex] = true;
      saveJSON(STORAGE_KEY, state);
    } else {
      // Ocultar explicación
      explicacionDiv.style.display = "none";
      btnExplicacion.textContent = "Ver explicación";
      
      // Marcar como oculta
      state[seccionId].explanationShown[qIndex] = false;
      saveJSON(STORAGE_KEY, state);
    }
  }

  function restoreSelectionsAndGrades(seccionId) {
    const s = state[seccionId];
    if (!s) return;

    const preguntas = preguntasPorSeccion[seccionId] || [];
    preguntas.forEach((preg, idx) => {
      const name = `pregunta${seccionId}${idx}`;
      const inputs = Array.from(document.getElementsByName(name));
      const guardadas = (s.answers && s.answers[idx]) || [];
      guardadas.forEach(mixedIdx => {
        if (inputs[mixedIdx]) inputs[mixedIdx].checked = true;
      });

      if (s.graded && s.graded[idx]) {
        const puntajeElem = document.getElementById(`puntaje-${seccionId}-${idx}`);
        const mInv = state[seccionId].shuffleMap[idx];
        const seleccionOriginal = guardadas.map(i => mInv[i]).sort();
        const correctaOriginal = preg.correcta.slice().sort();

        const isCorrect = JSON.stringify(seleccionOriginal) === JSON.stringify(correctaOriginal);
        if (isCorrect) {
          puntajeElem.textContent = "✅ Correcto (+1)";
        } else {
          puntajeElem.textContent = "❌ Incorrecto (0)";
        }

        const correctasMezcladas = correctaOriginal.map(ori =>
          parseInt(Object.keys(mInv).find(k => mInv[k] === ori), 10)
        );
        correctasMezcladas.forEach(i => {
          if (!isNaN(i) && inputs[i]) {
            inputs[i].parentElement.style.backgroundColor = "#eafaf1";
            inputs[i].parentElement.style.borderColor = "#1e7e34";
          }
        });
        guardadas.forEach(i => {
          const idxOriginal = mInv[i];
          if (!preg.correcta.includes(idxOriginal) && inputs[i]) {
            inputs[i].parentElement.style.backgroundColor = "#fdecea";
            inputs[i].parentElement.style.borderColor = "#c0392b";
          }
        });

        inputs.forEach(inp => (inp.disabled = true));
        const btn = inputs[0]?.closest(".pregunta")?.querySelector("button.btn-responder");
        if (btn) btn.disabled = true;

        if (!window.puntajesPorSeccion[seccionId]) window.puntajesPorSeccion[seccionId] = [];
        window.puntajesPorSeccion[seccionId][idx] = isCorrect ? 1 : 0;
      }

      // Restaurar estado de explicación si estaba mostrada
      if (s.explanationShown && s.explanationShown[idx]) {
        const explicacionDiv = document.getElementById(`explicacion-${seccionId}-${idx}`);
        const btnExplicacion = document.getElementById(`btn-explicacion-${seccionId}-${idx}`);
        if (explicacionDiv && btnExplicacion) {
          explicacionDiv.style.display = "block";
          btnExplicacion.textContent = "Ocultar explicación";
        }
      }
    });
  }


  function getDisplayOrder(seccionId, preguntasLen) {
    const s = state[seccionId];

    if (!s.answeredOrder) {
      s.answeredOrder = [];
    }

    // Para IAR y simulacro_iar: orden secuencial fijo (0, 1, 2, ...)
    const esIAR = seccionId.startsWith('iar') || seccionId.toLowerCase().includes('iar');
    if (esIAR) {
      const ordenSecuencial = [];
      for (let i = 0; i < preguntasLen; i++) { ordenSecuencial.push(i); }
      return ordenSecuencial;
    }

    // Para otros cuestionarios: respondidas arriba (orden fijo), no respondidas abajo (orden persistente)
    const answered = s.answeredOrder.slice();
    const unanswered = [];
    for (let i = 0; i < preguntasLen; i++) {
      if (!s.graded[i]) unanswered.push(i);
    }

    let shuffledUnanswered;
    if (s.unansweredOrder.length === 0 ||
        !unanswered.every(idx => s.unansweredOrder.includes(idx))) {
      shuffledUnanswered = shuffle(unanswered, seccionId + '-unanswered-initial');
      s.unansweredOrder = shuffledUnanswered.slice();
      saveJSON(STORAGE_KEY, state);
    } else {
      shuffledUnanswered = s.unansweredOrder.filter(idx => !s.graded[idx]);
    }

    return [...answered, ...shuffledUnanswered];
  }

  // ======== Render del cuestionario ========
  function generarCuestionario(seccionId, _onReady) {
    const preguntas = preguntasPorSeccion[seccionId];
    if (!preguntas) return;

    ensureSectionState(seccionId, preguntas.length);

    const cont = document.getElementById(`cuestionario-${seccionId}`);
    if (!cont) return;
    cont.innerHTML = "";

    // Obtener orden de visualización (respondidas arriba fijas, no respondidas abajo aleatorias)
    const displayOrder = getDisplayOrder(seccionId, preguntas.length);

    // Renderizar preguntas según el orden de visualización
    displayOrder.forEach((originalIdx, displayPosition) => {
      const preg = preguntas[originalIdx];
      const div = document.createElement("div");
      div.className = "pregunta";
      div.id = `pregunta-bloque-${seccionId}-${originalIdx}`;

      // Cabecera resultado
      const resultado = document.createElement("div");
      resultado.id = `puntaje-${seccionId}-${originalIdx}`;
      resultado.className = "resultado-pregunta";
      resultado.textContent = "";
      div.appendChild(resultado);

      // Enunciado (mostramos el número de posición visual, no el índice original)
      const h3 = document.createElement("h3");
      h3.textContent = `${displayPosition + 1}. ${preg.pregunta}`;
      div.appendChild(h3);


// ========== CÓDIGO NUEVO - AGREGAR DESPUÉS DEL h3 ==========
      // Mostrar imagen si existe
      if (preg.imagen) {
        const imgContainer = document.createElement("div");
        imgContainer.style.marginTop = "15px";
        imgContainer.style.marginBottom = "15px";
        imgContainer.style.textAlign = "center";
        
        const img = document.createElement("img");
        img.src = getImagenUrl(preg.imagen);
        img.alt = "Imagen ECG";
        img.style.maxWidth = "100%";
        img.style.height = "auto";
        img.style.border = "2px solid #ddd";
        img.style.borderRadius = "8px";
        img.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
        
        // Hacer clic en la imagen para verla más grande
        img.style.cursor = "pointer";
        img.onclick = function() {
          window.open(this.src, '_blank');
        };
        
        imgContainer.appendChild(img);
        div.appendChild(imgContainer);
      }
      // ========== FIN DEL CÓDIGO NUEVO ==========

      // Opciones (mezcladas)
      const tipoInput = preg.multiple ? "checkbox" : "radio";
      const { inv, opcionesMezcladas } = getOrBuildShuffleForQuestion(
        seccionId,
        originalIdx,
        preg.opciones
      );

      opcionesMezcladas.forEach((opc, mixedIdx) => {
        const label = document.createElement("label");
        label.className = "opcion";
        const input = document.createElement("input");
        input.type = tipoInput;
        input.name = `pregunta${seccionId}${originalIdx}`;
        input.value = mixedIdx;
        input.setAttribute("data-original-index", inv[mixedIdx]);
        
        input.addEventListener("change", () => {
          // Al cambiar una opción, congelar las opciones de ESTA pregunta
          if (!state[seccionId].shuffleMap[originalIdx]) {
            freezeShuffleForQuestion(seccionId, originalIdx);
          }
          persistSelectionsForQuestion(seccionId, originalIdx);
        });
        
        label.appendChild(input);
        const spanTexto = document.createElement("span");
        spanTexto.className = "opcion-texto";
        spanTexto.textContent = " " + opc;
        label.appendChild(spanTexto);
        div.appendChild(label);
      });

      // Contenedor de botones
      const botonesDiv = document.createElement("div");
      botonesDiv.style.marginTop = "10px";
      botonesDiv.style.display = "flex";
      botonesDiv.style.gap = "10px";
      botonesDiv.style.flexWrap = "wrap";

      // Botón Responder
      const btn = document.createElement("button");
      btn.textContent = "Responder";
      btn.className = "btn-responder";
      btn.addEventListener("click", () => responderPregunta(seccionId, originalIdx));
      botonesDiv.appendChild(btn);

      // Botón Ver Explicación (solo si hay explicación)
      if (preg.explicacion && preg.explicacion.trim() !== "") {
        const btnExplicacion = document.createElement("button");
        btnExplicacion.textContent = "Ver explicación";
        btnExplicacion.className = "btn-explicacion";
        btnExplicacion.id = `btn-explicacion-${seccionId}-${originalIdx}`;
        btnExplicacion.addEventListener("click", () => mostrarExplicacion(seccionId, originalIdx));
        botonesDiv.appendChild(btnExplicacion);
      }

      div.appendChild(botonesDiv);

      // Div para la explicación (oculto por defecto)
      if (preg.explicacion && preg.explicacion.trim() !== "") {
        const explicacionDiv = document.createElement("div");
        explicacionDiv.id = `explicacion-${seccionId}-${originalIdx}`;
        explicacionDiv.className = "explicacion-contenedor";
        explicacionDiv.style.display = "none";
        explicacionDiv.style.marginTop = "15px";
        explicacionDiv.style.padding = "15px";
        explicacionDiv.style.backgroundColor = "#f8f9fa";
        explicacionDiv.style.borderLeft = "4px solid #007bff";
        explicacionDiv.style.borderRadius = "4px";
        
        const explicacionTitulo = document.createElement("strong");
        explicacionTitulo.textContent = "Explicación:";
        explicacionTitulo.style.display = "block";
        explicacionTitulo.style.marginBottom = "8px";
        explicacionTitulo.style.color = "#007bff";
        
        const explicacionTexto = document.createElement("p");
        explicacionTexto.textContent = preg.explicacion;
        explicacionTexto.style.margin = "0";
        explicacionTexto.style.lineHeight = "1.6";
        
        explicacionDiv.appendChild(explicacionTitulo);
        explicacionDiv.appendChild(explicacionTexto);

        // Imagen de explicación (solo visible al abrir la explicación)
        if (preg.imagen_explicacion) {
          const imgExp = document.createElement("img");
          imgExp.src = getImagenUrl(preg.imagen_explicacion);
          imgExp.alt = "Imagen de la explicación";
          imgExp.style.maxWidth = "100%";
          imgExp.style.height = "auto";
          imgExp.style.marginTop = "12px";
          imgExp.style.border = "2px solid #ddd";
          imgExp.style.borderRadius = "8px";
          imgExp.style.display = "block";
          imgExp.style.cursor = "pointer";
          imgExp.title = "Clic para ampliar";
          imgExp.onclick = function() { window.open(this.src, '_blank'); };
          explicacionDiv.appendChild(imgExp);
        }

        div.appendChild(explicacionDiv);
      }

      cont.appendChild(div);
    });

    // Restaurar estado previo (selecciones y preguntas evaluadas)
    restoreSelectionsAndGrades(seccionId);

    // ── Modo tarjetita (OAV) ────────────────────────────────────────────
    // Si script_onebyone.js está cargado, activar el modo una-pregunta-por-vez
    // directamente aquí, sin polling ni race conditions.
    if (typeof window._oavRenderOAV === 'function' && typeof window._oavState !== 'undefined') {
      if (!window._oavState[seccionId]) {
        window._oavState[seccionId] = { currentIdx: 0, total: preguntas.length };
      }
      window._oavRenderOAV(seccionId);


    }
    // ────────────────────────────────────────────────────────────────────
    if (typeof _onReady === 'function') _onReady();
  }

  function persistSelectionsForQuestion(seccionId, qIndex) {
    const name = `pregunta${seccionId}${qIndex}`;
    const inputs = Array.from(document.getElementsByName(name));
    const seleccionadas = inputs
      .map((inp, i) => (inp.checked ? i : null))
      .filter(v => v !== null);

    if (!state[seccionId].answers) state[seccionId].answers = {};
    state[seccionId].answers[qIndex] = seleccionadas;
    saveJSON(STORAGE_KEY, state);
  }

  function responderPregunta(seccionId, qIndex) {
    const preguntas = preguntasPorSeccion[seccionId];
    const preg = preguntas[qIndex];

    const name = `pregunta${seccionId}${qIndex}`;
    const inputs = Array.from(document.getElementsByName(name));

    const seleccionMixed = inputs
      .map((inp, i) => (inp.checked ? i : null))
      .filter(v => v !== null);

    if (seleccionMixed.length === 0) {
      alert("Por favor, selecciona al menos una opción antes de responder.");
      return;
    }

    // Congelar las opciones de ESTA pregunta específica (si no está ya congelada)
    if (!state[seccionId].shuffleMap[qIndex]) {
      freezeShuffleForQuestion(seccionId, qIndex);
    }
    const mInv = state[seccionId].shuffleMap[qIndex];

    const seleccionOriginal = seleccionMixed.map(i => mInv[i]).sort();
    const correctaOriginal = preg.correcta.slice().sort();
    const isCorrect = JSON.stringify(seleccionOriginal) === JSON.stringify(correctaOriginal);

    const puntajeElem = document.getElementById(`puntaje-${seccionId}-${qIndex}`);
    if (isCorrect) {
      window.puntajesPorSeccion[seccionId][qIndex] = 1;
      puntajeElem.textContent = "✅ Correcto (+1)";
    } else {
      window.puntajesPorSeccion[seccionId][qIndex] = 0;
      puntajeElem.textContent = "❌ Incorrecto (0)";
    }

    const correctasMezcladas = correctaOriginal.map(ori =>
      parseInt(Object.keys(mInv).find(k => mInv[k] === ori), 10)
    );
    correctasMezcladas.forEach(i => {
      if (!isNaN(i) && inputs[i]) {
        inputs[i].parentElement.style.backgroundColor = "#eafaf1";
        inputs[i].parentElement.style.borderColor = "#1e7e34";
      }
    });
    seleccionMixed.forEach(i => {
      const ori = mInv[i];
      if (!preg.correcta.includes(ori) && inputs[i]) {
        inputs[i].parentElement.style.backgroundColor = "#fdecea";
        inputs[i].parentElement.style.borderColor = "#c0392b";
      }
    });

    inputs.forEach(inp => (inp.disabled = true));
    const btn = inputs[0]?.closest(".pregunta")?.querySelector("button.btn-responder");
    if (btn) btn.disabled = true;

    persistSelectionsForQuestion(seccionId, qIndex);
    state[seccionId].graded[qIndex] = true;
    
    // IMPORTANTE: Solo para cuestionarios NO-IAR, agregar a answeredOrder
    const esIAR = seccionId.startsWith('iar') || seccionId.toLowerCase().includes('iar');
    
    if (!esIAR) {
      // Para cuestionarios normales: agregar esta pregunta al orden de respondidas (si no está ya)
      if (!state[seccionId].answeredOrder) {
        state[seccionId].answeredOrder = [];
      }
      if (!state[seccionId].answeredOrder.includes(qIndex)) {
        state[seccionId].answeredOrder.push(qIndex);
        console.log('📌 Pregunta', qIndex, 'agregada a answeredOrder:', state[seccionId].answeredOrder);
      }
      
      // Eliminar de unansweredOrder
      if (state[seccionId].unansweredOrder) {
        const indexInUnanswered = state[seccionId].unansweredOrder.indexOf(qIndex);
        if (indexInUnanswered !== -1) {
          state[seccionId].unansweredOrder.splice(indexInUnanswered, 1);
          console.log('🗑️ Pregunta', qIndex, 'eliminada de unansweredOrder:', state[seccionId].unansweredOrder);
        }
      }
    } else {
      console.log('✅ IAR - Pregunta', qIndex, 'respondida sin cambiar orden de visualización');
    }
    
    // Guardar el estado completo
    saveJSON(STORAGE_KEY, state);
    console.log('💾 Estado guardado');
    
    // Re-renderizar solo si NO es IAR (para reorganizar preguntas respondidas arriba)
    if (!esIAR) {
      generarCuestionario(seccionId);
    }

    // ===== Verificar si se respondió la ÚLTIMA pregunta y mostrar puntuación automáticamente =====
    // Solo si OAV NO está activo (el OAV maneja su propio disparo vía _mostrarResultadoFinalOAV)
    const oavActivo = typeof window._oavRenderOAV === 'function' && typeof window._oavState !== 'undefined';
    if (!oavActivo) {
      const todasRespondidas = preguntas.every((_, idx) =>
        window.puntajesPorSeccion[seccionId]?.[idx] !== null &&
        window.puntajesPorSeccion[seccionId]?.[idx] !== undefined
      );
      if (todasRespondidas && !state[seccionId]?.totalShown) {
        setTimeout(() => mostrarResultadoFinal(seccionId), 300);
      }
    }
  }

  // ======== Mostrar resultado final ========
  function mostrarResultadoFinal(seccionId) {
    const preguntas = preguntasPorSeccion[seccionId] || [];
    const resultNode = document.getElementById(`resultado-total-${seccionId}`);
    // No hacer return si resultNode no existe o está oculto por OAV —
    // la lógica de checkmark, attemptLog y Firestore debe ejecutarse siempre.

    const totalScore = window.puntajesPorSeccion[seccionId].reduce((a, b) => a + (b || 0), 0);

    state[seccionId].totalShown = true;
    // Sincronizar también en localStorage (por si OAV escribió ahí directamente)
    try {
      const rawLS = localStorage.getItem(STORAGE_KEY);
      const allLS = rawLS ? JSON.parse(rawLS) : {};
      if (!allLS[seccionId]) allLS[seccionId] = {};
      allLS[seccionId].totalShown = true;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(allLS));
    } catch(e) {}
    saveJSON(STORAGE_KEY, state);

    // ======= AUTO-CHECKMARK: marcar el ☑ en el submenú al completar =======
    (function autoMarcarCompletado(sid) {
      var USER_KEY = 'iar_user_id_v1';
      var COMPLETED_KEY_PREFIX = 'iar_completed_v1_';
      try {
        var uid = localStorage.getItem(USER_KEY);
        if (!uid) return;
        var completedKey = COMPLETED_KEY_PREFIX + uid;
        var completed = {};
        try { completed = JSON.parse(localStorage.getItem(completedKey) || '{}'); } catch(e) {}
        if (!completed[sid]) {
          completed[sid] = true;
          localStorage.setItem(completedKey, JSON.stringify(completed));
          // Guardar completados en Firestore
          _guardarCompletadosFirestore(completed);
          // Actualizar UI del checkbox si está visible
          var allLis = document.querySelectorAll('li[onclick]');
          allLis.forEach(function(li) {
            var m = li.getAttribute('onclick').match(/mostrarCuestionario\('([^']+)'\)/);
            if (m && m[1] === sid) {
              li.classList.add('iar-completado');
              var inp = li.querySelector('.iar-check-input');
              if (inp) {
                inp.checked = true;
                var icon = li.querySelector('.iar-check-icon');
                if (icon) icon.title = 'Completado — clic para desmarcar';
              }
              // Actualizar también los botones de la barra inferior
              document.querySelectorAll('.nav-bar-btn[data-seccion="' + sid + '"]').forEach(function(btn) {
                btn.classList.add('nav-bar-btn-completado');
              });
            }
          });
        }
      } catch(e) {}
    })(seccionId);
    // ======= FIN AUTO-CHECKMARK =======

    attemptLog.push({
      sectionId: seccionId,
      sectionTitle: getSectionTitle(seccionId),
      iso: todayISO(),
      score: totalScore,
      total: preguntas.length
    });
    saveJSON(ATTEMPT_LOG_KEY, attemptLog);
    // Guardar historial en Firestore
    _guardarHistorialFirestore();

    // Actualizar colores de la barra de navegación inferior
    if (typeof renderNavBar === 'function') renderNavBar();
  }
  // Exponer en window para que script_onebyone.js (OAV) pueda disparar
  // el registro del intento (attemptLog + Firestore) al mostrar el resultado.
  window.mostrarResultadoFinal = mostrarResultadoFinal;


  // ======== Reiniciar Examen ========
  window.reiniciarExamen = function(seccionId) {
    const s = state[seccionId];
    const esIAR = seccionId.startsWith('iar') && seccionId !== 'simulacro_iar';

    const titulo = '¿Reiniciar este examen?';
    const mensaje = esIAR
      ? '¿Estás seguro de que deseas reiniciar este examen?\n\nSe borrarán TODAS tus respuestas y la puntuación.\nLas opciones de cada pregunta se presentarán en un NUEVO orden aleatorio.\nEsta acción no se puede deshacer.'
      : '¿Estás seguro de que deseas reiniciar este examen?\n\nSe borrarán TODAS tus respuestas y la puntuación.\nLas opciones de cada pregunta se presentarán en un NUEVO orden aleatorio.\nEsta acción no se puede deshacer.';

    mostrarDialogoConfirmacion(
      titulo,
      mensaje,
      function() {
        // Ejecutar callback pendiente de OAV (limpia marcas/índice) si existe
        if (typeof window._oavPendingReiniciarCallback === 'function') {
          window._oavPendingReiniciarCallback();
          window._oavPendingReiniciarCallback = null;
        }
        // Siempre aleatorizar opciones al reiniciar (aleatorizar=true)
        // Para IAR conservamos el orden de PREGUNTAS pero aleatorizamos las OPCIONES
        if (esIAR) {
          // Borrar solo shuffleMap para aleatorizar opciones, pero mantener estructura IAR
          const answeredOrderGuardado = s && s.answeredOrder ? s.answeredOrder.slice() : [];
          const unansweredOrderGuardado = s && s.unansweredOrder ? s.unansweredOrder.slice() : [];
          state[seccionId] = {
            shuffleFrozen: false,
            shuffleMap: {},          // vacío = se re-mezclará al regenerar
            answeredOrder: [],
            unansweredOrder: [...answeredOrderGuardado, ...unansweredOrderGuardado],
            answers: {},
            graded: {},
            totalShown: false,
            explanationShown: {}
          };
          saveJSON(STORAGE_KEY, state);
          // Borrar en Firestore para evitar que se restaure el progreso viejo al volver
          _borrarSeccionFirestore(seccionId);
          if (window.puntajesPorSeccion && window.puntajesPorSeccion[seccionId]) {
            window.puntajesPorSeccion[seccionId] = Array(
              (preguntasPorSeccion[seccionId] || []).length
            ).fill(null);
          }
          const resultadoTotal = document.getElementById(`resultado-total-${seccionId}`);
          if (resultadoTotal) { resultadoTotal.innerHTML = ""; resultadoTotal.className = "resultado-final"; }
        } else {
          // Para no-IAR: limpiar todo y aleatorizar todo (preguntas + opciones)
          // limpiarSeccion ya llama a _borrarSeccionFirestore internamente
          limpiarSeccion(seccionId, true);
        }

        generarCuestionario(seccionId);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
      function() {
        // Si cancela, limpiar el callback pendiente de OAV para no dejarlo colgado
        window._oavPendingReiniciarCallback = null;
      },
      { labelAceptar: '🔄 REINICIAR', labelCancelar: 'CANCELAR', colorAceptar: '#d97706' }
    );
  };

  function hasAnySelection(seccionId, qIndex) {
    const name = `pregunta${seccionId}${qIndex}`;
    const inputs = Array.from(document.getElementsByName(name));
    return inputs.some(inp => inp.checked);
  }

  // ======== Exponer showSection globalmente para el buscador ========
  window.showSection = showSection;

  // ======== Navegación carrusel entre cuestionarios IAR ========
  const IAR_CARRUSEL = [
    'iarsep2020','iaroct2020','iarnov2020','iardic2020',
    'iarfeb2021','iarmar2021','iarabr2021','iarmay2021','iarjun2021','iarago2021','iarsep2021','iarnov2021','iardic2021',
    'iarmar2022','iarabr2022','iarjun2022','iarago2022','iaroct2022','iardic2022',
    'iarmar2023','iarabr2023','iarmay2023','iarjun2023','iarago2023','iaroct2023','iardic2023',
    'iarmar2024','iarabr2024','iarmay2024','iarjun2024','iarago2024','iarsep2024','iaroct2024','iarnov2024','iardic2024',
    'iarfeb2025','iarmar2025','iarabr2025','iarjun2025','iarsep2025','iaroct2025','iarnov2025','iardic2025',
    'iarfeb2026'
  ];

  // ── Helper: detectar si hay respuestas marcadas en la sección actual ──
  // Lee siempre desde localStorage para capturar lo escrito por script_onebyone.js
  function hayRespuestasMarcadas(seccionId) {
    if (!seccionId) return false;
    // Sincronizar state en memoria antes de evaluar
    _sincronizarStateDesdeStorage(seccionId);
    return _hayProgresoEnStorage(seccionId);
  }

  // ── Diálogo de confirmación profesional para salir de un cuestionario en curso ──
  function confirmarSalidaCuestionario(onConfirmar) {
    if (!hayRespuestasMarcadas(currentSection)) {
      onConfirmar();
      return;
    }
    // Mensaje especial para Simulacro IAR: advertir que el progreso se pierde
    if (currentSection === 'simulacro_iar') {
      var simState = null;
      try { var _raw = localStorage.getItem('quiz_state_v3'); if (_raw) simState = JSON.parse(_raw)['simulacro_iar']; } catch(e) {}
      var simCompleto = simState && simState.totalShown;
      if (!simCompleto) {
        mostrarDialogoNavBar(
          '⚠️ Vas a salir del Simulacro IAR',
          '⛔ Las respuestas marcadas NO se guardarán.\n\nSi salís ahora, el progreso de este simulacro se perderá. La próxima vez que entres se generará un nuevo set de 20 preguntas.\n\n¿Querés salir de todas formas?',
          '✅ Sí, salir (perder progreso)',
          '↩️ No, seguir respondiendo',
          onConfirmar
        );
        return;
      }
    }
    mostrarDialogoNavBar(
      '⚠️ Tenés respuestas marcadas',
      'Si salís ahora, tu progreso en este cuestionario se conservará tal como está.\n\n¿Querés continuar de todas formas?',
      '✅ Sí, salir',
      '↩️ No, seguir respondiendo',
      onConfirmar
    );
  }

  window.navegarCuestionarioIAR = function(seccionActual, direccion) {
    var idx = IAR_CARRUSEL.indexOf(seccionActual);
    if (idx === -1) return;
    var nuevoIdx = (idx + direccion + IAR_CARRUSEL.length) % IAR_CARRUSEL.length;
    var destino = IAR_CARRUSEL[nuevoIdx];
    // Bloqueo demo: si el destino no está permitido, mostrar modal
    if (window._demoCheckEnabled && window._demoSeccionesPermitidas &&
        !window._demoSeccionesPermitidas.includes(destino)) {
      if (window.mostrarModalRestriccionDemo) window.mostrarModalRestriccionDemo();
      else if (typeof mostrarModalRestriccionDemo === 'function') mostrarModalRestriccionDemo();
      return;
    }
    confirmarSalidaCuestionario(function() {
      window.mostrarCuestionario(destino);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  // ── Carrusel para Ver Respuestas Correctas ──
  let _respuestasSeccionActual = '';
  window.navegarRespuestasIAR = function(seccionActual, direccion) {
    // Intentar obtener la sección actual de múltiples fuentes
    var sid = seccionActual
      || _respuestasSeccionActual
      || (document.getElementById('contenido-respuestas-examen') && document.getElementById('contenido-respuestas-examen').dataset.seccion)
      || '';
    var idx = IAR_CARRUSEL.indexOf(sid);
    if (idx === -1) {
      idx = 0;
    }
    var nuevoIdx = (idx + direccion + IAR_CARRUSEL.length) % IAR_CARRUSEL.length;
    var destino = IAR_CARRUSEL[nuevoIdx];
    // ── BLOQUEO DEMO ──
    if (window._demoCheckEnabled && window._demoSeccionesPermitidas &&
        !window._demoSeccionesPermitidas.includes(destino)) {
      if (window.mostrarModalRestriccionDemo) window.mostrarModalRestriccionDemo();
      else if (typeof mostrarModalRestriccionDemo === 'function') mostrarModalRestriccionDemo();
      return;
    }
    window.mostrarRespuestasExamen(destino);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Variable para rastrear el origen de navegación hacia un cuestionario
  let navegacionOrigen = null; // 'buscador' | 'submenu' | null

  // ======== Navegación (mostrar/ocultar páginas) ========
  window.mostrarCuestionario = function (seccionId) {
    // Cuando se llama desde el menú/submenú, el origen es 'submenu'
    navegacionOrigen = 'submenu';
    saveScrollPosition();
    saveLastSection(seccionId);  // Guardar para volver al ítem correcto al regresar
    history.pushState({ section: seccionId, origen: 'submenu' }, `Cuestionario ${seccionId}`, `#${seccionId}`);
    showSection(seccionId);
  };

  window.mostrarSubmenu = function (submenuId) {
    saveScrollPosition();
    saveLastSection(submenuId);  // Al volver al menú principal, resaltar el ítem del submenú
    // Ocultar botón flotante de progreso en submenús
    const _btnF = document.getElementById("btn-ver-progreso");
    if (_btnF) _btnF.style.display = "none";
    const _panF = document.getElementById("panel-progreso");
    if (_panF) _panF.style.display = "none";
    // Ocultar el menú principal
    document.getElementById("menu-principal")?.classList.add("oculto");
    // Ocultar todos los submenús y cuestionarios
    document.querySelectorAll(".menu-principal[id$='-submenu']").forEach(s => s.style.display = "none");
    document.querySelectorAll(".pagina-cuestionario").forEach(p => p.classList.remove("activa"));
    // Mostrar el submenú específico
    const submenu = document.getElementById(submenuId);
    if (submenu) {
      submenu.style.display = "block";
    }
    // Modo normal para la barra inferior del submenú
    navBarModo = 'normal';
    renderNavBar();
    // Agregar al historial del navegador para que "atrás" vuelva al menú principal
    history.pushState({ submenu: submenuId }, submenuId, `#${submenuId}`);
    window.scrollTo(0, 0);
  };

  window.volverAlSubmenu = function(submenuId) {
    // Siempre va al submenú indicado — el buscador tiene su propio botón flotante
    // Confirmación si hay respuestas en curso
    if (hayRespuestasMarcadas(currentSection)) {
      // Mensaje especial para Simulacro IAR: advertir que el progreso se pierde
      if (currentSection === 'simulacro_iar') {
        var _simSt = null;
        try { var _rr = localStorage.getItem('quiz_state_v3'); if (_rr) _simSt = JSON.parse(_rr)['simulacro_iar']; } catch(e) {}
        if (!(_simSt && _simSt.totalShown)) {
          mostrarDialogoNavBar(
            '⚠️ Vas a salir del Simulacro IAR',
            '⛔ Las respuestas marcadas NO se guardarán.\n\nSi salís ahora, el progreso de este simulacro se perderá. La próxima vez que entres se generará un nuevo set de 20 preguntas.\n\n¿Querés salir de todas formas?',
            '✅ Sí, salir (perder progreso)',
            '↩️ No, seguir respondiendo',
            function() { _ejecutarVolverAlSubmenu(submenuId); }
          );
          return;
        }
      }
      mostrarDialogoNavBar(
        '📋 ¿Salir del cuestionario?',
        'Tenés respuestas marcadas en el cuestionario actual.\n\nTu progreso se conservará si volvés más tarde. ¿Querés salir de todas formas?',
        '✅ Sí, volver al menú',
        '↩️ No, seguir respondiendo',
        function() { _ejecutarVolverAlSubmenu(submenuId); }
      );
      return;
    }
    _ejecutarVolverAlSubmenu(submenuId);
  };

  function _ejecutarVolverAlSubmenu(submenuId) {
    // Simulacro IAR: al salir al submenú SIEMPRE limpiar el progreso (no se guarda)
    // Excepción: si ya completó el cuestionario (totalShown), no limpiar
    if (currentSection === 'simulacro_iar') {
      var _simStateRaw2 = null;
      try { _simStateRaw2 = JSON.parse(localStorage.getItem('quiz_state_v3') || '{}')['simulacro_iar']; } catch(e) {}
      var _simCompleto2 = _simStateRaw2 && _simStateRaw2.totalShown;
      if (!_simCompleto2) {
        _limpiarSimulacroIARSinProgreso();
      }
    } else if (currentSection && state[currentSection] && state[currentSection].totalShown) {
      limpiarSeccion(currentSection, true);
    } else if (currentSection) {
      // Para secciones normales: leer progreso desde localStorage
      if (!_hayProgresoEnStorage(currentSection)) {
        limpiarSeccion(currentSection, true);
      } else {
        _sincronizarStateDesdeStorage(currentSection);
        _persistirIndiceOAVActual(currentSection);
      }
    }

    const seccionOrigen = currentSection;
    currentSection = null;
    document.querySelectorAll(".pagina-cuestionario").forEach(p => p.classList.remove("activa"));

    document.getElementById("menu-principal")?.classList.add("oculto");
    document.querySelectorAll(".menu-principal[id$='-submenu']").forEach(s => s.style.display = "none");
    const submenu = document.getElementById(submenuId);
    if (submenu) submenu.style.display = "block";
    history.pushState({ submenu: submenuId }, submenuId, `#${submenuId}`);

    setTimeout(() => scrollToSectionItem(seccionOrigen), 50);
  };

  window.volverAlMenu = function () {
    confirmarSalidaCuestionario(function() {
      if (currentSection !== null) {
        history.pushState({ section: null }, 'Menú Principal', '#menu');
      }
      document.querySelectorAll(".menu-principal[id$='-submenu']").forEach(s => s.style.display = "none");
      const _prc = document.getElementById('panel-respuestas-correctas');
      if (_prc) _prc.classList.add('oculto');
      const _pre2 = document.getElementById('pagina-respuestas-examen');
      if (_pre2) _pre2.classList.remove('activa');
      navBarModo = 'normal';
      showMenu();
    });
  };

  // ======== VER RESPUESTAS CORRECTAS ========
  const EXAMENES_IAR_ORDEN = [
    { id: 'iarsep2020', label: 'SEP 2020' }, { id: 'iaroct2020', label: 'OCT 2020' },
    { id: 'iarnov2020', label: 'NOV 2020' }, { id: 'iardic2020', label: 'DIC 2020' },
    { id: 'iarfeb2021', label: 'FEB 2021' }, { id: 'iarmar2021', label: 'MAR 2021' },
    { id: 'iarabr2021', label: 'ABR 2021' }, { id: 'iarmay2021', label: 'MAY 2021' },
    { id: 'iarjun2021', label: 'JUN 2021' }, { id: 'iarago2021', label: 'AGO 2021' },
    { id: 'iarsep2021', label: 'SEP 2021' }, { id: 'iarnov2021', label: 'NOV 2021' },
    { id: 'iardic2021', label: 'DIC 2021' },
    { id: 'iarmar2022', label: 'MAR 2022' }, { id: 'iarabr2022', label: 'ABR 2022' },
    { id: 'iarjun2022', label: 'JUN 2022' }, { id: 'iarago2022', label: 'AGO 2022' },
    { id: 'iaroct2022', label: 'OCT 2022' }, { id: 'iardic2022', label: 'DIC 2022' },
    { id: 'iarmar2023', label: 'MAR 2023' }, { id: 'iarabr2023', label: 'ABR 2023' },
    { id: 'iarmay2023', label: 'MAY 2023' }, { id: 'iarjun2023', label: 'JUN 2023' },
    { id: 'iarago2023', label: 'AGO 2023' }, { id: 'iaroct2023', label: 'OCT 2023' },
    { id: 'iardic2023', label: 'DIC 2023' },
    { id: 'iarmar2024', label: 'MAR 2024' },
    { id: 'iarabr2024', label: 'ABR 2024' }, { id: 'iarmay2024', label: 'MAY 2024' },
    { id: 'iarjun2024', label: 'JUN 2024' }, { id: 'iarago2024', label: 'AGO 2024' },
    { id: 'iarsep2024', label: 'SEP 2024' }, { id: 'iaroct2024', label: 'OCT 2024' },
    { id: 'iarnov2024', label: 'NOV 2024' }, { id: 'iardic2024', label: 'DIC 2024' },
    { id: 'iarfeb2025', label: 'FEB 2025' }, { id: 'iarmar2025', label: 'MAR 2025' },
    { id: 'iarabr2025', label: 'ABR 2025' },
    { id: 'iarjun2025', label: 'JUN 2025' },
    { id: 'iarsep2025', label: 'SEP 2025' }, { id: 'iaroct2025', label: 'OCT 2025' },
    { id: 'iarnov2025', label: 'NOV 2025' }, { id: 'iardic2025', label: 'DIC 2025' },
    { id: 'iarfeb2026', label: 'FEB 2026' },
  ];

  window.mostrarRespuestasCorrectas = function() {
    // ── BLOQUEO: solo admin puede acceder ──
    if (!window._esAdmin) return;
    // ── BLOQUEO DEMO: permite entrar al panel pero cada examen individual queda bloqueado ──
    // (el bloqueo por examen se hace en mostrarRespuestasExamen)
    // Ocultar botón flotante de progreso
    const _btnFR = document.getElementById("btn-ver-progreso");
    if (_btnFR) _btnFR.style.display = "none";
    const _panFR = document.getElementById("panel-progreso");
    if (_panFR) _panFR.style.display = "none";
    // Ocultar todo lo demás
    document.getElementById('menu-principal')?.classList.add('oculto');
    document.querySelectorAll('.menu-principal[id$="-submenu"]').forEach(s => s.style.display = 'none');
    document.querySelectorAll('.pagina-cuestionario').forEach(p => p.classList.remove('activa'));
    const _pb = document.getElementById('buscador-preguntas');
    if (_pb) _pb.classList.add('oculto');
    const _pre = document.getElementById('pagina-respuestas-examen');
    if (_pre) _pre.classList.remove('activa');

    const panel = document.getElementById('panel-respuestas-correctas');
    if (!panel) return;
    panel.classList.remove('oculto');

    // Modo respuestas para la barra inferior
    navBarModo = 'respuestas';
    renderNavBar();

    history.pushState({ respuestas: true }, 'Respuestas Correctas', '#respuestas');
    window.scrollTo(0, 0);
  };

  window.mostrarRespuestasExamen = function(seccionId) {
    // ── BLOQUEO: solo admin puede acceder ──
    if (!window._esAdmin) return;
    // ── BLOQUEO DEMO ──
    if (window._demoCheckEnabled && window._demoSeccionesPermitidas &&
        !window._demoSeccionesPermitidas.includes(seccionId)) {
      if (typeof mostrarModalRestriccionDemo === 'function') mostrarModalRestriccionDemo();
      return;
    }
    _respuestasSeccionActual = seccionId; // guardar para carrusel
    // Ocultar submenú de respuestas
    const panel = document.getElementById('panel-respuestas-correctas');
    if (panel) panel.classList.add('oculto');

    // Ocultar otras páginas
    document.querySelectorAll('.pagina-cuestionario').forEach(p => p.classList.remove('activa'));

    // Modo respuestas para la barra inferior
    navBarModo = 'respuestas';
    renderNavBar();

    // Preparar página individual
    const pagina = document.getElementById('pagina-respuestas-examen');
    if (!pagina) return;

    // Título
    const NOMBRES = {
      iarsep2020:'SEP 2020',iaroct2020:'OCT 2020',iarnov2020:'NOV 2020',iardic2020:'DIC 2020',
      iarfeb2021:'FEB 2021',iarmar2021:'MAR 2021',iarabr2021:'ABR 2021',iarmay2021:'MAY 2021',
      iarjun2021:'JUN 2021',iarago2021:'AGO 2021',iarsep2021:'SEP 2021',iarnov2021:'NOV 2021',iardic2021:'DIC 2021',
      iarmar2022:'MAR 2022',iarabr2022:'ABR 2022',iarjun2022:'JUN 2022',iarago2022:'AGO 2022',
      iaroct2022:'OCT 2022',iardic2022:'DIC 2022',
      iarmar2023:'MAR 2023',iarabr2023:'ABR 2023',iarmay2023:'MAY 2023',iarjun2023:'JUN 2023',
      iarago2023:'AGO 2023',iaroct2023:'OCT 2023',iardic2023:'DIC 2023',
      iarmar2024:'MAR 2024',iarabr2024:'ABR 2024',iarmay2024:'MAY 2024',
      iarjun2024:'JUN 2024',iarago2024:'AGO 2024',iarsep2024:'SEP 2024',iaroct2024:'OCT 2024',
      iarnov2024:'NOV 2024',iardic2024:'DIC 2024',
      iarfeb2025:'FEB 2025',iarmar2025:'MAR 2025',iarabr2025:'ABR 2025',
      iarjun2025:'JUN 2025',iarsep2025:'SEP 2025',iaroct2025:'OCT 2025',
      iarnov2025:'NOV 2025',iardic2025:'DIC 2025',
      iarfeb2026:'FEB 2026'
    };

    const titulo = document.getElementById('titulo-respuestas-examen');
    if (titulo) titulo.textContent = '📋 RESPUESTAS CORRECTAS — IAR ' + (NOMBRES[seccionId] || seccionId.toUpperCase());

    // Renderizar contenido
    const cont = document.getElementById('contenido-respuestas-examen');
    if (cont) {
      // Solo re-renderizar si cambió el examen
      if (cont.dataset.seccion !== seccionId) {
        _renderRespuestasExamen(cont, seccionId);
        cont.dataset.seccion = seccionId;
      }
    }

    pagina.classList.add('activa');
    history.pushState({ respuestasExamen: seccionId }, 'Respuestas ' + seccionId, '#respuestas-' + seccionId);
    window.scrollTo(0, 0);
  };

  window.volverAlSubmenuRespuestas = function() {
    const pagina = document.getElementById('pagina-respuestas-examen');
    if (pagina) pagina.classList.remove('activa');
    mostrarRespuestasCorrectas();
  };

  function _renderRespuestasExamen(cont, seccionId) {
    cont.innerHTML = '';
    const preguntas = preguntasPorSeccion[seccionId];

    if (preguntas && preguntas.length > 0) {
      _renderRespuestasExamenContenido(cont, preguntas);
      return;
    }

    // No están en memoria — usar polling igual que showSection
    cont.innerHTML = '<p style="text-align:center;color:#64748b;padding:40px;">⏳ Cargando preguntas...</p>';

    function _intentarCargar(intentos) {
      if (window.cargarSeccionFirestore) {
        window.cargarSeccionFirestore(seccionId).then(function(pregsFirestore) {
          if (pregsFirestore && pregsFirestore.length > 0) {
            preguntasPorSeccion[seccionId] = pregsFirestore;
            cont.innerHTML = '';
            _renderRespuestasExamenContenido(cont, pregsFirestore);
          } else {
            cont.innerHTML = '<p style="text-align:center;color:#64748b;padding:40px;">No hay preguntas cargadas para este examen.</p>';
          }
        });
      } else if (intentos < 20) {
        setTimeout(function() { _intentarCargar(intentos + 1); }, 200);
      } else {
        cont.innerHTML = '<p style="text-align:center;color:#dc2626;padding:40px;">⚠️ No se pudo conectar. Recargá la página.</p>';
      }
    }
    _intentarCargar(0);
  }

  function _renderRespuestasExamenContenido(cont, preguntas) {
    preguntas.forEach(function(preg, idx) {
      const pregDiv = document.createElement('div');
      pregDiv.className = 'rc-pregunta';

      // Número + enunciado
      const enunciado = document.createElement('div');
      enunciado.className = 'rc-enunciado';
      enunciado.textContent = (idx + 1) + '. ' + preg.pregunta;
      pregDiv.appendChild(enunciado);

      // Imagen si existe
      if (preg.imagen) {
        const img = document.createElement('img');
        img.src = getImagenUrl(preg.imagen);
        img.className = 'rc-imagen';
        img.alt = 'Imagen de la pregunta';
        img.onclick = function() { window.open(this.src, '_blank'); };
        pregDiv.appendChild(img);
      }

      // Badge de tipo (única / múltiple)
      const badge = document.createElement('span');
      badge.className = 'rc-badge-tipo';
      badge.textContent = preg.multiple ? '✦ Múltiple opción' : '✦ Opción única';
      pregDiv.appendChild(badge);

      // Opciones
      preg.opciones.forEach(function(opc, oi) {
        const esCorrecta = preg.correcta.includes(oi);
        const opcDiv = document.createElement('div');
        opcDiv.className = 'rc-opcion' + (esCorrecta ? ' rc-opcion-correcta' : '');

        const check = document.createElement('span');
        check.className = 'rc-check';
        check.textContent = esCorrecta ? '✅' : '◻';

        const letra = document.createElement('span');
        letra.className = 'rc-letra';
        letra.textContent = String.fromCharCode(65 + oi) + '.';

        const texto = document.createElement('span');
        texto.textContent = opc;

        opcDiv.appendChild(check);
        opcDiv.appendChild(letra);
        opcDiv.appendChild(texto);
        pregDiv.appendChild(opcDiv);
      });

      // Explicación si existe
      if (preg.explicacion && preg.explicacion.trim()) {
        const expToggle = document.createElement('button');
        expToggle.className = 'rc-btn-explicacion';
        expToggle.textContent = '💡 Ver explicación';
        expToggle.onclick = function() {
          const expDiv = pregDiv.querySelector('.rc-explicacion');
          if (expDiv) {
            const visible = expDiv.style.display !== 'none';
            expDiv.style.display = visible ? 'none' : 'block';
            expToggle.textContent = visible ? '💡 Ver explicación' : '💡 Ocultar explicación';
          }
        };
        pregDiv.appendChild(expToggle);

        const expDiv = document.createElement('div');
        expDiv.className = 'rc-explicacion';
        expDiv.style.display = 'none';
        expDiv.textContent = preg.explicacion;
        pregDiv.appendChild(expDiv);
      }

      cont.appendChild(pregDiv);
    });
  }

  // ======== Barra de navegación inferior: acceso rápido a todos los exámenes IAR ========
  const NAV_BAR_EXAMENES = [
    { year: '2020', exams: [
      { id: 'iarsep2020', label: 'SEP' }, { id: 'iaroct2020', label: 'OCT' },
      { id: 'iarnov2020', label: 'NOV' }, { id: 'iardic2020', label: 'DIC' }
    ]},
    { year: '2021', exams: [
      { id: 'iarfeb2021', label: 'FEB' }, { id: 'iarmar2021', label: 'MAR' },
      { id: 'iarabr2021', label: 'ABR' }, { id: 'iarmay2021', label: 'MAY' },
      { id: 'iarjun2021', label: 'JUN' }, { id: 'iarago2021', label: 'AGO' },
      { id: 'iarsep2021', label: 'SEP' }, { id: 'iarnov2021', label: 'NOV' },
      { id: 'iardic2021', label: 'DIC' }
    ]},
    { year: '2022', exams: [
      { id: 'iarmar2022', label: 'MAR' }, { id: 'iarabr2022', label: 'ABR' },
      { id: 'iarjun2022', label: 'JUN' }, { id: 'iarago2022', label: 'AGO' },
      { id: 'iaroct2022', label: 'OCT' }, { id: 'iardic2022', label: 'DIC' }
    ]},
    { year: '2023', exams: [
      { id: 'iarmar2023', label: 'MAR' }, { id: 'iarabr2023', label: 'ABR' },
      { id: 'iarmay2023', label: 'MAY' }, { id: 'iarjun2023', label: 'JUN' },
      { id: 'iarago2023', label: 'AGO' }, { id: 'iaroct2023', label: 'OCT' },
      { id: 'iardic2023', label: 'DIC' }
    ]},
    { year: '2024', exams: [
      { id: 'iarmar2024', label: 'MAR' },
      { id: 'iarabr2024', label: 'ABR' }, { id: 'iarmay2024', label: 'MAY' },
      { id: 'iarjun2024', label: 'JUN' }, { id: 'iarago2024', label: 'AGO' },
      { id: 'iarsep2024', label: 'SEP' }, { id: 'iaroct2024', label: 'OCT' },
      { id: 'iarnov2024', label: 'NOV' }, { id: 'iardic2024', label: 'DIC' }
    ]},
    { year: '2025', exams: [
      { id: 'iarfeb2025', label: 'FEB' }, { id: 'iarmar2025', label: 'MAR' },
      { id: 'iarabr2025', label: 'ABR' },
      { id: 'iarjun2025', label: 'JUN' },
      { id: 'iarsep2025', label: 'SEP' }, { id: 'iaroct2025', label: 'OCT' },
      { id: 'iarnov2025', label: 'NOV' }, { id: 'iardic2025', label: 'DIC' }
    ]},
    { year: '2026', exams: [
      { id: 'iarfeb2026', label: 'FEB' }
    ]}
  ];

  function getCompletedSections() {
    var USER_KEY = 'iar_user_id_v1';
    var COMPLETED_KEY_PREFIX = 'iar_completed_v1_';
    try {
      var uid = localStorage.getItem(USER_KEY);
      if (!uid) return {};
      var completedKey = COMPLETED_KEY_PREFIX + uid;
      return JSON.parse(localStorage.getItem(completedKey) || '{}');
    } catch(e) { return {}; }
  }

  function buildNavBar() {
    // La barra se inyecta como elemento estático al final de cada pagina-cuestionario
    // y también al final del panel del buscador.
    // Se crea un único template y se clona/inyecta en cada contenedor.
    _injectNavBarsIntoPages();
  }

  function _injectNavBarsIntoPages() {
    const completed = getCompletedSections();

    // Inyectar en todas las paginas-cuestionario EXCEPTO el simulacro
    document.querySelectorAll('.pagina-cuestionario').forEach(function(page) {
      if (page.id === 'simulacro_iar') return; // no mostrar barra en simulacro
      _injectOrUpdateNavBar(page, completed);
    });

    // NO inyectar en submenús IAR ni en buscador
  }

  // Variable que indica el modo actual de la barra inferior
  // 'normal' = navega a cuestionarios IAR | 'respuestas' = navega a respuestas correctas
  let navBarModo = 'normal';

  function _buildNavBarElement(completed) {
    const bar = document.createElement('div');
    bar.className = 'nav-bar-inferior-static nav-bar-visible';

    const titulo = document.createElement('div');
    titulo.className = 'nav-bar-titulo';
    titulo.textContent = navBarModo === 'respuestas'
      ? '📅 ACCESO RÁPIDO - EXÁMENES IAR - RESPUESTAS CORRECTAS'
      : '📅 ACCESO RÁPIDO - EXÁMENES IAR - CUESTIONARIOS';
    bar.appendChild(titulo);

    // Una sola fila con wrap — año + botones fluyen juntos
    const fila = document.createElement('div');
    fila.className = 'nav-bar-fila';

    NAV_BAR_EXAMENES.forEach(function(grupo) {
      // Etiqueta del año inline
      const yearLabel = document.createElement('span');
      yearLabel.className = 'nav-bar-year';
      yearLabel.textContent = grupo.year;
      fila.appendChild(yearLabel);

      // Botones de meses
      grupo.exams.forEach(function(exam) {
        const btn = document.createElement('button');
        btn.className = 'nav-bar-btn' + (completed[exam.id] ? ' nav-bar-btn-completado' : '');
        btn.setAttribute('data-seccion', exam.id);
        btn.textContent = exam.label;
        btn.title = 'IAR ' + exam.label + ' ' + grupo.year;
        btn.addEventListener('click', function() {
          if (navBarModo === 'respuestas') {
            mostrarRespuestasExamen(exam.id);
          } else {
            navegarDesdeNavBar(exam.id);
          }
        });
        fila.appendChild(btn);
      });
    });

    bar.appendChild(fila);
    return bar;
  }

  function _injectOrUpdateNavBar(container, completed) {
    // Remover barra anterior si existe
    const old = container.querySelector('.nav-bar-inferior-static');
    if (old) old.remove();

    const bar = _buildNavBarElement(completed || getCompletedSections());
    container.appendChild(bar);
  }

  function renderNavBar() {
    // Actualiza colores de todos los botones en todas las barras estáticas inyectadas
    const completed = getCompletedSections();
    document.querySelectorAll('.nav-bar-inferior-static .nav-bar-btn').forEach(function(btn) {
      const sid = btn.getAttribute('data-seccion');
      if (completed[sid]) {
        btn.classList.add('nav-bar-btn-completado');
      } else {
        btn.classList.remove('nav-bar-btn-completado');
      }
    });
    // Actualizar títulos según el modo
    const tituloTexto = navBarModo === 'respuestas'
      ? '📅 ACCESO RÁPIDO - EXÁMENES IAR - RESPUESTAS CORRECTAS'
      : '📅 ACCESO RÁPIDO - EXÁMENES IAR - CUESTIONARIOS';
    document.querySelectorAll('.nav-bar-inferior-static .nav-bar-titulo').forEach(function(t) {
      t.textContent = tituloTexto;
    });
  }
  window.renderNavBar = renderNavBar;

  function navegarDesdeNavBar(seccionId) {
    // ── BLOQUEO DEMO ──
    if (window._demoCheckEnabled && window._demoSeccionesPermitidas &&
        !window._demoSeccionesPermitidas.includes(seccionId)) {
      if (typeof mostrarModalRestriccionDemo === 'function') mostrarModalRestriccionDemo();
      return;
    }
    // Si ya estamos en ese cuestionario, no hacer nada
    if (currentSection === seccionId) return;

    // ¿Hay un cuestionario en curso?
    const hayCuestionarioEnCurso = currentSection && state[currentSection] &&
      !state[currentSection].totalShown &&
      state[currentSection].graded &&
      Object.keys(state[currentSection].graded).some(k => state[currentSection].graded[k]);

    // ¿Hay una búsqueda en curso?
    const panelBuscador = document.getElementById('buscador-preguntas');
    const hayBusqueda = panelBuscador && !panelBuscador.classList.contains('oculto') &&
      (document.getElementById('buscador-input')?.value || '').trim().length >= 2;

    if (hayCuestionarioEnCurso) {
      mostrarDialogoNavBar(
        '📋 ¿Salir del cuestionario actual?',
        'Estás en medio de un cuestionario con respuestas marcadas.\n\nTu progreso se guardará y podrás retomarlo cuando quieras. ¿Querés ir a otro examen?',
        '✅ Sí, cambiar de examen',
        '↩️ No, seguir aquí',
        function() {
          ejecutarNavegacionNavBar(seccionId);
        }
      );
    } else if (hayBusqueda) {
      mostrarDialogoNavBar(
        '🔍 ¿Abandonar la búsqueda?',
        'Tenés una búsqueda en proceso. Si navegás ahora, se borrará la búsqueda actual.',
        '✅ Sí, ir al examen',
        '↩️ No, seguir buscando',
        function() {
          window.limpiarBusqueda && window.limpiarBusqueda();
          ejecutarNavegacionNavBar(seccionId);
        }
      );
    } else {
      ejecutarNavegacionNavBar(seccionId);
    }
  }

  function ejecutarNavegacionNavBar(seccionId) {
    // Limpiar estado del cuestionario actual si es necesario
    if (currentSection && state[currentSection]) {
      const s = state[currentSection];
      if (s.totalShown) {
        limpiarSeccion(currentSection, true);
      } else {
        const hayRespuestas = s.graded && Object.keys(s.graded).some(k => s.graded[k]);
        limpiarSeccion(currentSection, !hayRespuestas);
      }
    }
    navegacionOrigen = 'submenu';
    saveScrollPosition();
    saveLastSection(seccionId);
    history.pushState({ section: seccionId, origen: 'submenu' }, `Cuestionario ${seccionId}`, `#${seccionId}`);
    showSection(seccionId);
  }

  function mostrarDialogoNavBar(titulo, mensaje, textoAceptar, textoCancelar, onAceptar) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:99999;display:flex;justify-content:center;align-items:center;';

    const dialogo = document.createElement('div');
    dialogo.style.cssText = 'background:#fff;padding:28px 32px;border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,0.22);max-width:420px;width:90%;text-align:center;';

    const tit = document.createElement('h3');
    tit.textContent = titulo;
    tit.style.cssText = 'margin:0 0 14px;color:#1f2937;font-size:1.15rem;line-height:1.4;';

    const msg = document.createElement('p');
    msg.textContent = mensaje;
    msg.style.cssText = 'margin:0 0 22px;color:#475569;font-size:0.93rem;line-height:1.6;white-space:pre-line;';

    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:10px;justify-content:center;flex-wrap:wrap;';

    const btnSi = document.createElement('button');
    btnSi.textContent = textoAceptar;
    btnSi.style.cssText = 'padding:10px 22px;background:#0d7490;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-size:0.9rem;';
    btnSi.onclick = function() { document.body.removeChild(overlay); onAceptar(); };

    const btnNo = document.createElement('button');
    btnNo.textContent = textoCancelar;
    btnNo.style.cssText = 'padding:10px 22px;background:#e2e8f0;color:#475569;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-size:0.9rem;';
    btnNo.onclick = function() { document.body.removeChild(overlay); };

    btns.appendChild(btnSi);
    btns.appendChild(btnNo);
    dialogo.appendChild(tit);
    dialogo.appendChild(msg);
    dialogo.appendChild(btns);
    overlay.appendChild(dialogo);
    document.body.appendChild(overlay);
  }

  // Actualizar colores de la barra al volver al menú o submenú
  const _origShowMenu = showMenu;
  // (hook will be applied after DOMContentLoaded)

  // ======== Botón flotante "Ver mi progreso" ========
  // Función para abrir/cerrar el panel de progreso (reutilizable desde botones inline)
  window.togglePanelProgreso = function() {
    const panel = document.getElementById("panel-progreso");
    if (!panel) return;
    if (panel.style.display === "block") {
      panel.style.display = "none";
    } else {
      const content = document.getElementById("contenido-progreso");
      if (content) renderProgress(content);
      panel.style.display = "block";
    }
  };

  function buildProgressUI() {
    const btn = document.createElement("button");
    btn.id = "btn-ver-progreso";
    btn.textContent = "Ver mi progreso";
    btn.style.position = "fixed";
    btn.style.right = "16px";
    btn.style.bottom = "16px";
    btn.style.zIndex = "1000";
    btn.style.padding = "10px 14px";
    btn.style.border = "none";
    btn.style.borderRadius = "999px";
    btn.style.boxShadow = "0 4px 12px rgba(0,0,0,.15)";
    btn.style.cursor = "pointer";
    btn.style.fontWeight = "bold";
    btn.style.background = "#2ecc71";
    btn.style.color = "#fff";
    // El botón flotante solo es visible en el menú principal
    btn.style.display = "none";
    document.body.appendChild(btn);

    const panel = document.createElement("div");
    panel.id = "panel-progreso";
    panel.style.position = "fixed";
    panel.style.right = "16px";
    panel.style.bottom = "70px";
    panel.style.width = "320px";
    panel.style.maxWidth = "92vw";
    panel.style.maxHeight = "60vh";
    panel.style.overflow = "auto";
    panel.style.background = "#fff";
    panel.style.border = "1px solid #dee2e6";
    panel.style.borderRadius = "12px";
    panel.style.boxShadow = "0 8px 24px rgba(0,0,0,.2)";
    panel.style.padding = "12px";
    panel.style.display = "none";
    panel.style.zIndex = "1001";

    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    const title = document.createElement("strong");
    title.textContent = "Historial de intentos";
    const close = document.createElement("button");
    close.textContent = "Cerrar";
    close.style.border = "none";
    close.style.background = "#e0e0e0";
    close.style.borderRadius = "8px";
    close.style.padding = "6px 10px";
    close.style.cursor = "pointer";
    header.appendChild(title);
    header.appendChild(close);

    const content = document.createElement("div");
    content.id = "contenido-progreso";
    content.style.marginTop = "10px";
    content.innerHTML = "<em>Sin intentos aún.</em>";

    // Botón borrar historial
    const btnBorrar = document.createElement("button");
    btnBorrar.id = "btn-borrar-historial";
    btnBorrar.textContent = "🗑️ Borrar mi historial";
    btnBorrar.style.cssText = "margin-top:14px;width:100%;padding:8px 10px;border:1.5px solid #fca5a5;border-radius:8px;background:#fff5f5;color:#b91c1c;font-weight:bold;cursor:pointer;font-size:.85rem;display:none;";
    btnBorrar.addEventListener("click", function() {
      if (!confirm("¿Seguro que querés borrar todo tu historial de intentos?\nEsta acción no se puede deshacer.")) return;
      attemptLog = [];
      saveJSON(ATTEMPT_LOG_KEY, []);
      // Borrar también en Firestore
      if (_firestoreUID && _firestoreDB) {
        import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js").then(function(fsModule) {
          const ref = fsModule.doc(_firestoreDB, "progreso", _firestoreUID, "datos", "historial");
          fsModule.setDoc(ref, { entries: [], _ts: fsModule.serverTimestamp() })
            .then(function() { console.log("[IAR Sync] 🗑️ Historial borrado en Firestore"); })
            .catch(function(e) { console.warn("[IAR Sync] Error borrando historial en Firestore:", e.message); });
        });
      }
      const c = document.getElementById("contenido-progreso");
      if (c) c.innerHTML = "<em>Sin intentos aún.</em>";
      btnBorrar.style.display = "none";
    });

    panel.appendChild(header);
    panel.appendChild(content);
    panel.appendChild(btnBorrar);
    document.body.appendChild(panel);

    btn.addEventListener("click", () => window.togglePanelProgreso());
    close.addEventListener("click", () => (panel.style.display = "none"));
  }

  // ======== Agregar botón estático "Ver mi progreso" en páginas de cuestionario ========
  function insertarBotonesProgresoInline() {
    document.querySelectorAll(".pagina-cuestionario").forEach(function(pagina) {
      pagina.querySelectorAll("div").forEach(function(div) {
        const reiniciar = div.querySelector(".btn-reiniciar");
        if (!reiniciar) return;
        if (div.querySelector(".btn-progreso-inline")) return;
        const btnProgreso = document.createElement("button");
        btnProgreso.className = "btn-reiniciar btn-progreso-inline";
        btnProgreso.textContent = "📊 Ver mi progreso";
        btnProgreso.addEventListener("click", function() {
          window.togglePanelProgreso();
        });
        reiniciar.insertAdjacentElement("afterend", btnProgreso);
      });
    });
  }

  function renderProgress(container) {
    const data = loadJSON(ATTEMPT_LOG_KEY, []);
    const btnBorrar = document.getElementById("btn-borrar-historial");
    if (!data.length) {
      container.innerHTML = "<em>Sin intentos aún.</em>";
      if (btnBorrar) btnBorrar.style.display = "none";
      return;
    }
    if (btnBorrar) btnBorrar.style.display = "block";

    const sorted = data.slice().sort((a, b) => {
      const da = new Date(a.iso).getTime();
      const db = new Date(b.iso).getTime();
      if (db !== da) return db - da;
      if (a.sectionTitle !== b.sectionTitle) return a.sectionTitle.localeCompare(b.sectionTitle);
      return db - da;
    });

    const byDate = {};
    sorted.forEach(item => {
      const d = toLocalDateStr(item.iso);
      if (!byDate[d]) byDate[d] = [];
      byDate[d].push(item);
    });

    container.innerHTML = "";
    Object.keys(byDate).forEach(dateLabel => {
      const group = document.createElement("div");
      group.style.marginBottom = "12px";
      const h = document.createElement("div");
      h.style.fontWeight = "bold";
      h.style.marginBottom = "6px";
      h.textContent = dateLabel;
      group.appendChild(h);

      byDate[dateLabel].forEach(item => {
        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";
        row.style.padding = "6px 8px";
        row.style.border = "1px solid #eee";
        row.style.borderRadius = "8px";
        row.style.marginBottom = "6px";
        const left = document.createElement("div");
        left.textContent = item.sectionTitle;
        const right = document.createElement("div");
        right.textContent = `${item.score}/${item.total}`;
        right.style.fontWeight = "bold";
        row.appendChild(left);
        row.appendChild(right);
        group.appendChild(row);
      });

      container.appendChild(group);
    });
  }

  // ======== Inicio ========
  document.addEventListener("DOMContentLoaded", () => {
    buildProgressUI();
    insertarBotonesProgresoInline();
    buildNavBar();
    setupBrowserNavigation();
    clearScrollPosition();

    // ── Limpiar progreso del Simulacro IAR si el usuario recarga o cierra la página ──
    // El progreso del simulacro NO se guarda entre sesiones si está incompleto.
    // "pagehide" se dispara en recarga, cierre de pestaña y navegación a otra página.
    window.addEventListener('pagehide', function() {
      try {
        var rawSt = localStorage.getItem('quiz_state_v3');
        if (!rawSt) return;
        var allSt = JSON.parse(rawSt);
        var simSt = allSt['simulacro_iar'];
        // Solo limpiar si hay progreso incompleto (respondió ≥1 pero no terminó)
        if (simSt && !simSt.totalShown) {
          var nGraded = simSt.graded ? Object.keys(simSt.graded).filter(function(k){ return simSt.graded[k]; }).length : 0;
          var nAnswers = simSt.answers ? Object.keys(simSt.answers).filter(function(k){ var a = simSt.answers[k]; return Array.isArray(a) && a.length > 0; }).length : 0;
          if (nGraded > 0 || nAnswers > 0) {
            // Limpiar estado en localStorage
            delete allSt['simulacro_iar'];
            localStorage.setItem('quiz_state_v3', JSON.stringify(allSt));
            localStorage.removeItem('simulacro_iar_preguntas_v1');
            localStorage.removeItem('simulacro_iar_tiene_progreso_v1');
            localStorage.removeItem('simulacro_iar_timer_end_v1');
          }
        }
      } catch(e) {}
    });

  const hash = window.location.hash.substring(1);
  // Lista de todas las secciones válidas (aunque preguntasPorSeccion esté vacío por Firestore)
  const SECCIONES_VALIDAS = [
    'iarsep2020','iaroct2020','iarnov2020','iardic2020',
    'iarfeb2021','iarmar2021','iarabr2021','iarmay2021','iarjun2021','iarago2021','iarsep2021','iarnov2021','iardic2021',
    'iarmar2022','iarabr2022','iarjun2022','iarago2022','iaroct2022','iardic2022',
    'iarmar2023','iarabr2023','iarmay2023','iarjun2023','iarago2023','iaroct2023','iardic2023',
    'iarmar2024','iarabr2024','iarmay2024','iarjun2024','iarago2024','iarsep2024','iaroct2024','iarnov2024','iardic2024',
    'iarfeb2025','iarmar2025','iarabr2025','iarjun2025','iarsep2025','iaroct2025','iarnov2025','iardic2025',
    'iarfeb2026','simulacro_iar'
  ];
  if (hash && hash !== 'menu' && SECCIONES_VALIDAS.includes(hash)) {
    showSection(hash);
    currentSection = hash;
  } else if (hash === 'respuestas') {
    if (window._esAdmin) { mostrarRespuestasCorrectas(); } else { history.replaceState({ section: null }, 'Menú Principal', '#menu'); showMenu(); }
  } else if (hash && hash.startsWith('respuestas-')) {
    const secId = hash.replace('respuestas-', '');
    if (window._esAdmin) { mostrarRespuestasExamen(secId); } else { history.replaceState({ section: null }, 'Menú Principal', '#menu'); showMenu(); }
  } else if (hash && document.getElementById(hash)) {
    // ← NUEVO: el hash corresponde a un submenú (ej: 'iar-submenu', 'otro-submenu')
    // Restaurar el submenú sin ir al menú principal
    const submenuEl = document.getElementById(hash);
    const esSubmenu = submenuEl && (submenuEl.classList.contains('menu-principal') || submenuEl.id.endsWith('-submenu'));
    if (esSubmenu) {
      document.getElementById("menu-principal")?.classList.add("oculto");
      document.querySelectorAll(".menu-principal[id$='-submenu']").forEach(s => s.style.display = "none");
      document.querySelectorAll(".pagina-cuestionario").forEach(p => p.classList.remove("activa"));
      submenuEl.style.display = "block";
      history.replaceState({ submenu: hash }, hash, `#${hash}`);
    } else {
      history.replaceState({ section: null }, 'Menú Principal', '#menu');
      showMenu();
    }
  } else {
    history.replaceState({ section: null }, 'Menú Principal', '#menu');
    showMenu();
  }
  });

  // ======== MEDIDAS DE SEGURIDAD ========
  
  document.addEventListener('contextmenu', function(e) {
      e.preventDefault();
      return false;
  });

  document.addEventListener('keydown', function(e) {
      if (e.keyCode === 123 ||
          (e.ctrlKey && e.shiftKey && (e.keyCode === 73 || e.keyCode === 74)) ||
          (e.ctrlKey && e.keyCode === 85) ||
          (e.ctrlKey && e.keyCode === 83) ||
          (e.ctrlKey && e.keyCode === 80) ||
          (e.ctrlKey && e.keyCode === 65)) {
          e.preventDefault();
          return false;
      }
  });

  let devtools = {open: false, orientation: null};
  setInterval(function() {
      if (window.outerHeight - window.innerHeight > 160 || 
          window.outerWidth - window.innerWidth > 160) {
          if (!devtools.open) {
              devtools.open = true;
              alert('Por favor, cierre las herramientas de desarrollo para continuar.');
              window.location.reload();
          }
      } else {
          devtools.open = false;
      }
  }, 500);

  document.addEventListener('dragstart', function(e) {
      e.preventDefault();
      return false;
  });

  document.addEventListener('selectstart', function(e) {
      if (!e.target.matches('input, textarea')) {
          e.preventDefault();
          return false;
      }
  });

  window.addEventListener('beforeprint', function(e) {
      e.preventDefault();
      alert('La impresión no está permitida en esta aplicación.');
      return false;
  });

  console.log('%cADVERTENCIA!', 'color: red; font-size: 50px; font-weight: bold;');
  console.log('%cEsta función del navegador está destinada a desarrolladores. Si alguien te pidió copiar y pegar algo aquí, es una estafa.', 'color: red; font-size: 16px;');
  
  setInterval(function() {
      console.clear();
  }, 3000);


  // ======== SIMULACRO IAR — 20 preguntas de la base IAR mensual ========
  // REGLA: siempre nuevo simulacro al entrar, SALVO que haya ≥1 respuesta guardada
  //        (en cuyo caso se conserva hasta terminar, reiniciar o crear nuevo).

  const SIMULACRO_IAR_KEY   = 'simulacro_iar_preguntas_v1';
  const SIMULACRO_IAR_PROGRESO = 'simulacro_iar_tiene_progreso_v1'; // '1' si respondió ≥1

  const SECCIONES_IAR_SIMULACRO = [
    'iarsep2020','iaroct2020','iarnov2020','iardic2020',
    'iarfeb2021','iarmar2021','iarabr2021','iarmay2021','iarjun2021','iarago2021','iarsep2021','iarnov2021','iardic2021',
    'iarmar2022','iarabr2022','iarjun2022','iarago2022','iaroct2022','iardic2022',
    'iarmar2023','iarabr2023','iarmay2023','iarjun2023','iarago2023','iaroct2023','iardic2023',
    'iarmar2024','iarabr2024','iarmay2024','iarjun2024','iarago2024','iarsep2024','iaroct2024','iarnov2024','iardic2024',
    'iarfeb2025','iarmar2025','iarabr2025','iarjun2025','iarsep2025','iaroct2025','iarnov2025','iardic2025',
    'iarfeb2026'
  ];

  function _tieneProgresoSimulacroIAR() {
    // Leer desde localStorage (fuente de verdad: script_onebyone.js escribe ahí directamente)
    return _hayProgresoEnStorage('simulacro_iar');
  }

  function generarNuevasPreguntasSimulacroIAR() {
    var TARGET = 20;
    var todasLasPreguntas = [];
    SECCIONES_IAR_SIMULACRO.forEach(function(sec) {
      var pregs = preguntasPorSeccion[sec];
      if (!Array.isArray(pregs) || pregs.length === 0) return;
      pregs.forEach(function(p, i) {
        todasLasPreguntas.push({ seccion: sec, idx: i, pregunta: p });
      });
    });

    if (todasLasPreguntas.length === 0) {
      console.warn('[SimulacroIAR] No hay preguntas IAR cargadas aún');
      return [];
    }

    // Separar preguntas independientes y grupos
    var unidadesMap = {};
    var unidadesSueltas = [];
    todasLasPreguntas.forEach(function(item) {
      var gid = item.pregunta.grupoId;
      if (gid) {
        if (!unidadesMap[gid]) unidadesMap[gid] = [];
        unidadesMap[gid].push(item);
      } else {
        unidadesSueltas.push([item]);
      }
    });

    // Ordenar cada grupo internamente: por ordenEnGrupo (si existe), luego por índice original
    Object.keys(unidadesMap).forEach(function(gid) {
      unidadesMap[gid].sort(function(a, b) {
        var oa = (a.pregunta.ordenEnGrupo != null) ? Number(a.pregunta.ordenEnGrupo) : a.idx;
        var ob = (b.pregunta.ordenEnGrupo != null) ? Number(b.pregunta.ordenEnGrupo) : b.idx;
        if (oa !== ob) return oa - ob;
        return a.idx - b.idx; // desempate por índice original en la sección
      });
    });

    var unidadesGrupo = Object.values(unidadesMap);

    // Validar integridad de grupos: descartar grupos incompletos (faltan preguntas en Firestore)
    unidadesGrupo = unidadesGrupo.filter(function(grupo) {
      var esperadas = grupo[0] && grupo[0].pregunta.totalEnGrupo ? Number(grupo[0].pregunta.totalEnGrupo) : grupo.length;
      var completo = grupo.length === esperadas;
      if (!completo) {
        console.warn('[SimulacroIAR] Grupo incompleto descartado: ' + (grupo[0] && grupo[0].pregunta.grupoId) +
          ' — tiene ' + grupo.length + '/' + esperadas + ' preguntas');
      }
      return completo;
    });

    // Mezclar independientes y elegir exactamente 1 grupo (si cabe)
    var sueltas = shuffle(unidadesSueltas, 'sim-sueltas-' + Date.now());
    var grupos  = shuffle(unidadesGrupo,  'sim-grupos-'  + Date.now());

    // Primero elegir las preguntas sueltas que vamos a usar
    var grupoElegido = null;
    var cantGrupo = 0;
    if (grupos.length > 0 && grupos[0].length <= TARGET - 1) {
      grupoElegido = grupos[0]; // ya está ordenado internamente por ordenEnGrupo
      cantGrupo = grupoElegido.length;
      console.log('[SimulacroIAR] Grupo elegido: ' + grupoElegido[0].pregunta.grupoId +
        ' (' + cantGrupo + ' preguntas, ordenadas por ordenEnGrupo: ' +
        grupoElegido.map(function(g){ return g.pregunta.ordenEnGrupo; }).join('→') + ')');
    }

    // Tomar las sueltas necesarias para llegar a TARGET
    var sueltasElegidas = [];
    for (var i = 0; i < sueltas.length && sueltasElegidas.length < TARGET - cantGrupo; i++) {
      sueltasElegidas.push(sueltas[i][0]);
    }

    // Insertar el bloque del grupo en una posición aleatoria dentro de las sueltas
    // El bloque siempre es contiguo y en el orden correcto (ordenEnGrupo 1→2→3→4)
    var seleccionadas = sueltasElegidas.slice();
    if (grupoElegido) {
      // Posición aleatoria: entre 0 y sueltasElegidas.length (inclusive)
      var posInsercion = Math.floor(Math.random() * (sueltasElegidas.length + 1));
      // Insertar de adelante hacia atrás para mantener el orden correcto del grupo
      for (var j = grupoElegido.length - 1; j >= 0; j--) {
        seleccionadas.splice(posInsercion, 0, grupoElegido[j]);
      }
      console.log('[SimulacroIAR] Bloque del grupo insertado en posición ' + posInsercion +
        ' (preguntas ' + (posInsercion+1) + '–' + (posInsercion+cantGrupo) + ' del simulacro)');
    }

    var grupoUsado = grupoElegido !== null;

    console.log('[SimulacroIAR] Generado: ' + seleccionadas.length + ' preguntas (grupo=' + grupoUsado + ')');
    localStorage.setItem(SIMULACRO_IAR_KEY, JSON.stringify(seleccionadas));
    return seleccionadas;
  }

  function _persistirPreguntasSimulacroIAREnStorage() {
    try {
      var pregs = preguntasPorSeccion['simulacro_iar'];
      if (!pregs || pregs.length === 0) return;
      var items = pregs.map(function(p) { return { pregunta: p }; });
      localStorage.setItem(SIMULACRO_IAR_KEY, JSON.stringify(items));
    } catch(e) {}
  }

  function _limpiarSimulacroIARSinProgreso() {
    // Limpiar el timer del simulacro (widget + localStorage key)
    if (window._simulacroTimer) window._simulacroTimer.limpiar();
    localStorage.removeItem(SIMULACRO_IAR_KEY);
    try { localStorage.removeItem(SIMULACRO_IAR_PROGRESO); } catch(e) {}
    delete state['simulacro_iar'];
    saveJSON(STORAGE_KEY, state);
    // Borrar en Firestore para evitar restauración de progreso viejo
    _borrarSeccionFirestore('simulacro_iar');
    if (window.puntajesPorSeccion) delete window.puntajesPorSeccion['simulacro_iar'];
    delete preguntasPorSeccion['simulacro_iar'];
    _limpiarOAVIdx('simulacro_iar');
    var rt = document.getElementById('resultado-total-simulacro_iar');
    if (rt) { rt.textContent = ''; rt.className = 'resultado-final'; }
  }

  // Carga secciones desde Firestore para recuperar preguntas del simulacro en progreso
  // (caso: usuario tenía progreso pero recargó la página y la memoria se perdió)
  function _cargarConProgresoDesdeFirestore() {
    var cont = document.getElementById('cuestionario-simulacro_iar');
    if (cont) {
      cont.innerHTML = '<div style="text-align:center;padding:60px 20px;color:#64748b;">' +
        '<div style="font-size:2rem;margin-bottom:12px;">⏳</div>' +
        '<div style="font-size:1rem;font-weight:600;">Recuperando tu progreso...</div>' +
        '<div style="font-size:.85rem;margin-top:8px;color:#94a3b8;">Un momento...</div>' +
        '</div>';
    }
    var seccionesFaltantes = SECCIONES_IAR_SIMULACRO.filter(function(sec) {
      return !Array.isArray(preguntasPorSeccion[sec]) || preguntasPorSeccion[sec].length === 0;
    });
    function _esperar(intentos) {
      if (!window.cargarSeccionFirestore) {
        if (intentos < 30) { setTimeout(function() { _esperar(intentos + 1); }, 200); }
        return;
      }
      var promesas = seccionesFaltantes.map(function(sec) {
        return window.cargarSeccionFirestore(sec).then(function(pregs) {
          if (pregs && pregs.length > 0) preguntasPorSeccion[sec] = pregs;
        }).catch(function() {});
      });
      Promise.all(promesas).then(function() {
        if (currentSection !== 'simulacro_iar') return;
        // Ahora intentar recuperar las preguntas guardadas en SIMULACRO_IAR_KEY
        var guardadas = loadJSON(SIMULACRO_IAR_KEY, null);
        if (guardadas && guardadas.length > 0) {
          preguntasPorSeccion['simulacro_iar'] = guardadas.map(function(i) { return i.pregunta; });
          generarCuestionario('simulacro_iar');
        } else {
          // Fallback: generar nuevo (no deberíamos llegar aquí)
          var items = generarNuevasPreguntasSimulacroIAR();
          if (items && items.length > 0) {
            preguntasPorSeccion['simulacro_iar'] = items.map(function(i) { return i.pregunta; });
            generarCuestionario('simulacro_iar');
          }
        }
      });
    }
    _esperar(0);
  }

  // Exponer para firebase-auth.js (logout) y otros modulos externos
  window._tieneProgresoSimulacroIARPublic = _tieneProgresoSimulacroIAR;
  window._persistirPreguntasSimulacroIAREnStorage = _persistirPreguntasSimulacroIAREnStorage;

  window.inicializarSimulacroIAR = function() {
    // ── BLOQUEO DEMO: esperar a que la licencia esté verificada ──
    // Esto evita que un usuario demo acceda al simulacro con F5 o navegación
    // rápida antes de que _demoCheckEnabled esté activo.
    var _licPromise = window._licenciaVerificada || Promise.resolve({ esDemo: false });
    _licPromise.then(function(lic) {
      if (lic.esDemo) {
        // Redirigir al menú y mostrar modal de restricción
        if (typeof mostrarSeccion === 'function') mostrarSeccion('menu-principal');
        else { document.getElementById('simulacro_iar')?.classList.remove('activa'); document.getElementById('menu-principal')?.classList.remove('oculto'); }
        if (typeof mostrarModalRestriccionDemo === 'function') mostrarModalRestriccionDemo();
        return;
      }
      _inicializarSimulacroIARInterno();
    });
  };

  function _inicializarSimulacroIARInterno() {
    // Progreso real = respondió ≥1 pregunta Y no terminó (totalShown)
    if (_tieneProgresoSimulacroIAR()) {
      // Intentar recuperar preguntas desde memoria primero
      if (preguntasPorSeccion['simulacro_iar'] && preguntasPorSeccion['simulacro_iar'].length > 0) {
        console.log('[SimulacroIAR] Progreso detectado (memoria) → conservando y mostrando');
        generarCuestionario('simulacro_iar');
        return;
      }
      // Si la memoria está vacía (ej: recarga de página), recuperar desde localStorage
      var guardadas = loadJSON(SIMULACRO_IAR_KEY, null);
      if (guardadas && guardadas.length > 0) {
        console.log('[SimulacroIAR] Progreso detectado (localStorage) → recuperando ' + guardadas.length + ' preguntas');
        preguntasPorSeccion['simulacro_iar'] = guardadas.map(function(i) { return i.pregunta; });
        generarCuestionario('simulacro_iar');
        return;
      }
      // Si tampoco hay en localStorage, necesitamos recargar desde Firestore
      // para poder mostrar las preguntas con el progreso guardado
      console.log('[SimulacroIAR] Progreso detectado pero sin preguntas en cache → recargando desde Firestore');
      // Continúa al flujo de carga desde Firestore (no hace return)
      // pero SIN limpiar el progreso (_limpiarSimulacroIARSinProgreso NO se llama aquí)
      _cargarConProgresoDesdeFirestore();
      return;
    }

    // Sin progreso (nuevo inicio, reinicio sin responder, o vuelta al menú sin responder) → nuevo simulacro
    _limpiarSimulacroIARSinProgreso();

    // Verificar secciones faltantes en memoria
    var seccionesFaltantes = SECCIONES_IAR_SIMULACRO.filter(function(sec) {
      return !Array.isArray(preguntasPorSeccion[sec]) || preguntasPorSeccion[sec].length === 0;
    });

    if (seccionesFaltantes.length === 0) {
      // Todas en memoria → generar y mostrar
      var items = generarNuevasPreguntasSimulacroIAR();
      if (items && items.length > 0) {
        preguntasPorSeccion['simulacro_iar'] = items.map(function(i) { return i.pregunta; });
        generarCuestionario('simulacro_iar');
      }
      return;
    }

    // Hay secciones sin cargar → cargar todas en paralelo desde Firestore
    var cont = document.getElementById('cuestionario-simulacro_iar');
    if (cont) {
      cont.innerHTML = '<div style="text-align:center;padding:60px 20px;color:#64748b;">' +
        '<div style="font-size:2rem;margin-bottom:12px;">⏳</div>' +
        '<div style="font-size:1rem;font-weight:600;">Cargando banco de preguntas...</div>' +
        '<div style="font-size:.85rem;margin-top:8px;color:#94a3b8;">Esto solo ocurre la primera vez</div>' +
        '</div>';
    }

    function _esperarFirestore(intentos) {
      if (!window.cargarSeccionFirestore) {
        if (intentos < 30) { setTimeout(function() { _esperarFirestore(intentos + 1); }, 200); }
        return;
      }
      var promesas = seccionesFaltantes.map(function(sec) {
        return window.cargarSeccionFirestore(sec).then(function(pregs) {
          if (pregs && pregs.length > 0) preguntasPorSeccion[sec] = pregs;
        }).catch(function() {});
      });
      Promise.all(promesas).then(function() {
        if (currentSection !== 'simulacro_iar') return;
        var items = generarNuevasPreguntasSimulacroIAR();
        if (items && items.length > 0) {
          preguntasPorSeccion['simulacro_iar'] = items.map(function(i) { return i.pregunta; });
          generarCuestionario('simulacro_iar');
        } else if (cont) {
          cont.innerHTML = '<div style="text-align:center;padding:60px 20px;color:#dc2626;">' +
            '<div style="font-size:2rem;margin-bottom:12px;">⚠️</div>' +
            '<div style="font-size:1rem;font-weight:600;">No se pudieron cargar las preguntas.</div>' +
            '<div style="font-size:.88rem;margin-top:8px;">Verificá tu conexión e intentá nuevamente.</div>' +
            '</div>';
        }
      });
    }
    _esperarFirestore(0);
  };

  window.crearNuevoSimulacroIAR = function() {
    mostrarDialogoConfirmacion(
      '¿Crear nuevo cuestionario IAR?',
      '¿Estás seguro de que deseas crear un nuevo simulacro?\n\nSe generarán 20 preguntas nuevas. Se borrará TODO el progreso del simulacro actual.\nEsta acción no se puede deshacer.',
      function() {
        _limpiarSimulacroIARSinProgreso();
        var items = generarNuevasPreguntasSimulacroIAR();
        preguntasPorSeccion['simulacro_iar'] = items.map(function(i) { return i.pregunta; });
        generarCuestionario('simulacro_iar');
        window.scrollTo(0, 0);
      },
      null,
      { labelAceptar: '🎲 CREAR NUEVO', labelCancelar: 'CANCELAR', colorAceptar: '#1e40af' }
    );
  };

  window.reiniciarSimulacroIAR = function() {
    mostrarDialogoConfirmacion(
      '¿Reiniciar este simulacro?',
      '¿Estás seguro de que deseas reiniciar este simulacro?\n\nSe borrarán TODAS tus respuestas y la puntuación. Si deseás generar preguntas NUEVAS, usá el botón "🎲 Crear nuevo cuestionario IAR".\nEsta acción no se puede deshacer.',
      function() {
        // Guardar las preguntas actuales ANTES de limpiar el estado
        var preguntasActuales = preguntasPorSeccion['simulacro_iar']
          ? preguntasPorSeccion['simulacro_iar'].slice()
          : null;

        // Limpiar solo el estado de progreso (respuestas, calificaciones) — SIN borrar las preguntas del localStorage
        delete state['simulacro_iar'];
        saveJSON(STORAGE_KEY, state);
        // Borrar en Firestore para evitar restauración de progreso viejo
        _borrarSeccionFirestore('simulacro_iar');
        if (window.puntajesPorSeccion) delete window.puntajesPorSeccion['simulacro_iar'];
        var rt = document.getElementById('resultado-total-simulacro_iar');
        if (rt) { rt.textContent = ''; rt.className = 'resultado-final'; }

        // Restaurar las MISMAS preguntas (no generar nuevas)
        if (preguntasActuales && preguntasActuales.length > 0) {
          preguntasPorSeccion['simulacro_iar'] = preguntasActuales;
        } else {
          // Fallback: si por algún motivo no hay preguntas en memoria, generar nuevas
          var items = generarNuevasPreguntasSimulacroIAR();
          if (items && items.length > 0) {
            preguntasPorSeccion['simulacro_iar'] = items.map(function(i) { return i.pregunta; });
          }
        }
        generarCuestionario('simulacro_iar');
        window.scrollTo(0, 0);
      },
      null,
      { labelAceptar: '🔄 REINICIAR', labelCancelar: 'CANCELAR', colorAceptar: '#d97706' }
    );
  };

  // Diálogo de opciones al terminar simulacro_iar
  document.addEventListener('DOMContentLoaded', function() {
    window.mostrarPuntuacionTotal = function(seccionId) {
      mostrarResultadoFinal(seccionId);
      if (seccionId !== 'simulacro_iar') return;
      // Mostrar diálogo de opciones tras ver la puntuación
      setTimeout(function() {
        var dlg = document.createElement('div');
        dlg.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;';
        dlg.innerHTML = '<div style="background:#fff;border-radius:14px;padding:32px 28px;max-width:400px;width:90%;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,0.25);">' +
          '<div style="font-size:1.3rem;font-weight:800;color:#1e3a8a;margin-bottom:12px;">🎓 ¡Simulacro completado!</div>' +
          '<p style="color:#475569;margin-bottom:24px;font-size:.95rem;">¿Qué querés hacer ahora?</p>' +
          '<div style="display:flex;flex-direction:column;gap:10px;">' +
          '<button id="sim-dlg-salir" style="padding:12px;background:linear-gradient(135deg,#64748b,#475569);color:#fff;border:none;border-radius:8px;font-size:.95rem;font-weight:600;cursor:pointer;">🏠 Salir al menú principal</button>' +
          '<button id="sim-dlg-reiniciar" style="padding:12px;background:linear-gradient(135deg,#059669,#047857);color:#fff;border:none;border-radius:8px;font-size:.95rem;font-weight:600;cursor:pointer;">🔄 Reiniciar este simulacro</button>' +
          '<button id="sim-dlg-nuevo" style="padding:12px;background:linear-gradient(135deg,#1e3a8a,#1e40af);color:#fff;border:none;border-radius:8px;font-size:.95rem;font-weight:600;cursor:pointer;">🎲 Crear nuevo simulacro</button>' +
          '</div></div>';
        document.body.appendChild(dlg);
        document.getElementById('sim-dlg-salir').onclick = function() {
          dlg.remove();
          _limpiarSimulacroIARSinProgreso();
          window.location.href = 'https://examenesiaruba.github.io/#menu';
        };
        document.getElementById('sim-dlg-reiniciar').onclick = function() {
          dlg.remove();
          // Guardar las preguntas actuales ANTES de limpiar el estado
          var preguntasActuales = preguntasPorSeccion['simulacro_iar']
            ? preguntasPorSeccion['simulacro_iar'].slice()
            : null;
          delete state['simulacro_iar'];
          saveJSON(STORAGE_KEY, state);
          // Borrar en Firestore para evitar restauración de progreso viejo
          _borrarSeccionFirestore('simulacro_iar');
          if (window.puntajesPorSeccion) delete window.puntajesPorSeccion['simulacro_iar'];
          var rt = document.getElementById('resultado-total-simulacro_iar');
          if (rt) { rt.textContent = ''; rt.className = 'resultado-final'; }
          // Restaurar las MISMAS preguntas
          if (preguntasActuales && preguntasActuales.length > 0) {
            preguntasPorSeccion['simulacro_iar'] = preguntasActuales;
          }
          generarCuestionario('simulacro_iar');
          window.scrollTo(0, 0);
        };
        document.getElementById('sim-dlg-nuevo').onclick = function() {
          dlg.remove();
          _limpiarSimulacroIARSinProgreso();
          var items = generarNuevasPreguntasSimulacroIAR();
          preguntasPorSeccion['simulacro_iar'] = items.map(function(i) { return i.pregunta; });
          generarCuestionario('simulacro_iar');
          window.scrollTo(0, 0);
        };
      }, 400);
    };
  });

  function mostrarDialogoConfirmacion(titulo, mensaje, onAceptar, onCancelar, optsExtra) {
    // optsExtra (opcional): { labelAceptar, labelCancelar, colorAceptar }
    var opts = optsExtra || {};
    var labelAceptar  = opts.labelAceptar  || 'Aceptar';
    var labelCancelar = opts.labelCancelar || 'Cancelar';
    var colorAceptar  = opts.colorAceptar  || '#28a745';

    // Crear overlay
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
    overlay.style.zIndex = '9999';
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'center';
    
    // Crear diálogo
    const dialogo = document.createElement('div');
    dialogo.style.backgroundColor = 'white';
    dialogo.style.padding = '30px';
    dialogo.style.borderRadius = '10px';
    dialogo.style.boxShadow = '0 4px 6px rgba(0, 0, 0, 0.1)';
    dialogo.style.maxWidth = '450px';
    dialogo.style.width = '90%';
    dialogo.style.textAlign = 'center';
    
    const tituloEl = document.createElement('h3');
    tituloEl.textContent = titulo;
    tituloEl.style.marginBottom = '15px';
    tituloEl.style.color = '#333';
    tituloEl.style.fontSize = '1.3rem';
    
    const mensajeEl = document.createElement('p');
    // Respetar saltos de línea en el mensaje
    mensajeEl.style.whiteSpace = 'pre-line';
    mensajeEl.textContent = mensaje;
    mensajeEl.style.marginBottom = '25px';
    mensajeEl.style.color = '#666';
    mensajeEl.style.lineHeight = '1.6';
    mensajeEl.style.textAlign = 'left';
    
    const botonesDiv = document.createElement('div');
    botonesDiv.style.display = 'flex';
    botonesDiv.style.gap = '10px';
    botonesDiv.style.justifyContent = 'center';
    botonesDiv.style.flexWrap = 'wrap';
    
    // Botón Cancelar (va primero, según módulo 7)
    const btnCancelar = document.createElement('button');
    btnCancelar.textContent = labelCancelar;
    btnCancelar.className = 'btn-responder';
    btnCancelar.style.minWidth = '120px';
    btnCancelar.style.backgroundColor = '#6c757d';
    btnCancelar.onclick = function() {
      document.body.removeChild(overlay);
      if (onCancelar) onCancelar();
    };

    // Botón Aceptar (va segundo, según módulo 7)
    const btnAceptar = document.createElement('button');
    btnAceptar.textContent = labelAceptar;
    btnAceptar.className = 'btn-responder';
    btnAceptar.style.minWidth = '120px';
    btnAceptar.style.backgroundColor = colorAceptar;
    btnAceptar.onclick = function() {
      document.body.removeChild(overlay);
      if (onAceptar) onAceptar();
    };
    
    botonesDiv.appendChild(btnCancelar);
    botonesDiv.appendChild(btnAceptar);
    
    dialogo.appendChild(tituloEl);
    dialogo.appendChild(mensajeEl);
    dialogo.appendChild(botonesDiv);
    overlay.appendChild(dialogo);
    document.body.appendChild(overlay);
  }
  

})();
/* ======================================================
   BUSCADOR DE PREGUNTAS
   ====================================================== */

(function () {

    var BUSCADOR_KEY = 'buscador_ultimo_query_v1';

    var NOMBRES_EXAMENES = {
        iarsep2020:'SEP 2020',iaroct2020:'OCT 2020',iarnov2020:'NOV 2020',iardic2020:'DIC 2020',
        iarfeb2021:'FEB 2021',iarmar2021:'MAR 2021',iarabr2021:'ABR 2021',iarmay2021:'MAY 2021',
        iarjun2021:'JUN 2021',iarago2021:'AGO 2021',iarsep2021:'SEP 2021',iarnov2021:'NOV 2021',iardic2021:'DIC 2021',
        iarmar2022:'MAR 2022',iarabr2022:'ABR 2022',iarjun2022:'JUN 2022',iarago2022:'AGO 2022',
        iaroct2022:'OCT 2022',iardic2022:'DIC 2022',
        iarmar2023:'MAR 2023',iarabr2023:'ABR 2023',iarmay2023:'MAY 2023',iarjun2023:'JUN 2023',
        iarago2023:'AGO 2023',iaroct2023:'OCT 2023',iardic2023:'DIC 2023',
        iarmar2024:'MAR 2024',iarabr2024:'ABR 2024',iarmay2024:'MAY 2024',
        iarjun2024:'JUN 2024',iarago2024:'AGO 2024',iarsep2024:'SEP 2024',iaroct2024:'OCT 2024',
        iarnov2024:'NOV 2024',iardic2024:'DIC 2024',
        iarfeb2025:'FEB 2025',iarmar2025:'MAR 2025',iarabr2025:'ABR 2025',
        iarjun2025:'JUN 2025',iarsep2025:'SEP 2025',iaroct2025:'OCT 2025',
        iarnov2025:'NOV 2025',iardic2025:'DIC 2025',
        iarfeb2026:'FEB 2026',simulacro_iar:'SIMULACRO IAR'
    };

    function nombreExamen(id) { return NOMBRES_EXAMENES[id] || id.toUpperCase(); }

    // Normaliza tildes/acentos para búsqueda sin distinción
    function normalizarTexto(str) {
        if (!str) return '';
        return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    }

    function escaparRegex(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g,'&amp;').replace(/</g,'&lt;')
            .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function resaltarTexto(texto, termino) {
        if (!termino) return escapeHtml(texto);
        // Construir regex que matchee con o sin tildes
        var terminoNorm = normalizarTexto(termino);
        // Buscar posiciones en el texto original comparando normalizado
        var textoNorm = normalizarTexto(texto);
        var result = '';
        var i = 0;
        var lenT = terminoNorm.length;
        while (i < texto.length) {
            if (textoNorm.substr(i, lenT) === terminoNorm) {
                result += '<mark>' + escapeHtml(texto.substr(i, lenT)) + '</mark>';
                i += lenT;
            } else {
                result += escapeHtml(texto[i]);
                i++;
            }
        }
        return result;
    }

    function truncar(texto, maxLen) {
        if (!texto) return '';
        return texto.length <= maxLen ? texto : texto.substring(0, maxLen) + '\u2026';
    }

    // Usa el sistema de clases del app (oculto / activa), NO style.display
    function ocultarTodo() {
        document.getElementById('menu-principal')?.classList.add('oculto');
        document.querySelectorAll('.menu-principal[id$="-submenu"]').forEach(s => s.style.display = 'none');
        document.querySelectorAll('.pagina-cuestionario').forEach(p => p.classList.remove('activa'));
        var pb = document.getElementById('buscador-preguntas');
        if (pb) pb.classList.add('oculto');
    }

    // ── Abrir buscador ──
    window.mostrarBuscador = function () {
        // Ocultar botón flotante de progreso en el buscador
        var _btnFB = document.getElementById("btn-ver-progreso");
        if (_btnFB) _btnFB.style.display = "none";
        var _panFB = document.getElementById("panel-progreso");
        if (_panFB) _panFB.style.display = "none";
        ocultarTodo();
        var panel = document.getElementById('buscador-preguntas');
        if (panel) panel.classList.remove('oculto');

        renderNavBar();

        var q = '';
        try { q = localStorage.getItem(BUSCADOR_KEY) || ''; } catch(e) {}
        var inp = document.getElementById('buscador-input');
        if (inp) { inp.value = q; setTimeout(function(){ inp.focus(); }, 100); }
        if (q.length >= 2) realizarBusqueda(q);
    };

    // ── Limpiar búsqueda ──
    window.limpiarBusqueda = function () {
        var inp = document.getElementById('buscador-input');
        if (inp) { inp.value = ''; inp.focus(); }
        document.getElementById('buscador-resultados').innerHTML = '';
        document.getElementById('buscador-stats').style.display = 'none';
        try { localStorage.removeItem(BUSCADOR_KEY); } catch(e) {}
    };

    // ── Ir a una pregunta desde el buscador ──
    window.irAPreguntaDesdeBuscador = function (seccionId, originalIdx) {
        // Verificar restricción demo usando el flag global
        if (window._demoCheckEnabled && window._demoSeccionesPermitidas &&
            !window._demoSeccionesPermitidas.includes(seccionId)) {
            if (typeof window.mostrarModalRestriccionDemo === 'function') {
              window.mostrarModalRestriccionDemo();
            } else {
              var overlay = document.getElementById('demo-restriccion-overlay');
              if (overlay) overlay.style.display = 'flex';
            }
            return;
        }
        try { sessionStorage.setItem('buscador_origen', '1'); } catch(e) {}
        // Marcar origen de navegación como buscador
        if (typeof navegacionOrigen !== 'undefined') navegacionOrigen = 'buscador';

        // Guardar posición de scroll ACTUAL y el card exacto antes de navegar
        try {
            localStorage.setItem('buscador_scroll_pos', String(window.pageYOffset || document.documentElement.scrollTop));
            localStorage.setItem('buscador_last_card', seccionId + '_' + originalIdx);
        } catch(e) {}

        // Marcar esta tarjeta como visitada
        var visitKey = 'buscador_visited_v1';
        var visited = {};
        try { visited = JSON.parse(localStorage.getItem(visitKey) || '{}'); } catch(e) {}
        var cardId = seccionId + '_' + originalIdx;
        visited[cardId] = true;
        try { localStorage.setItem(visitKey, JSON.stringify(visited)); } catch(e) {}

        // Aplicar estilo visitado a las tarjetas correspondientes de inmediato
        document.querySelectorAll('[data-buscador-card-id="' + cardId + '"]').forEach(function(el) {
            el.classList.add('buscador-card-visitada');
        });

        // Capturar query antes de navegar
        var queryActual = '';
        try { queryActual = localStorage.getItem(BUSCADOR_KEY) || ''; } catch(e) {}
        var inputEl = document.getElementById('buscador-input');
        if (inputEl && inputEl.value.trim().length >= 2) queryActual = inputEl.value.trim();

        // Indicar al modo OAV (una-por-una) qué pregunta mostrar y cuál es el query
        // script_onebyone.js lee esto en renderOAV() antes de decidir currentIdx
        window._buscadorTargetIdx = originalIdx;
        window._buscadorQueryPendiente = queryActual;

        // Callback para modo TODO-A-LA-VEZ: se ejecuta cuando generarCuestionario termina
        // En modo OAV este callback no se llama (renderOAV usa _buscadorTargetIdx directamente)
        function _scrollAPregunta() {
            var bloque = document.getElementById('pregunta-bloque-' + seccionId + '-' + originalIdx);
            if (!bloque) {
                // Modo OAV: la pregunta se muestra directamente, hacer scroll al tope
                window.scrollTo({ top: 0, behavior: 'smooth' });
                return;
            }
            // Modo todo-a-la-vez: scroll a la pregunta exacta con resaltado
            requestAnimationFrame(function() {
                bloque.scrollIntoView({ behavior: 'smooth', block: 'center' });
                bloque.classList.add('buscador-highlight');
                _resaltarTextoBuscado(bloque, queryActual);
                setTimeout(function () { bloque.classList.remove('buscador-highlight'); }, 2500);
            });
        }

        // Depositar callback ANTES de llamar showSection
        window._buscadorPendienteScroll = _scrollAPregunta;

        // Usar showSection del sistema original (maneja currentSection y generarCuestionario)
        if (typeof showSection === 'function') {
            showSection(seccionId);
        } else {
            // Fallback manual
            window._buscadorPendienteScroll = null;
            window._buscadorTargetIdx = null;
            ocultarTodo();
            var pagina = document.getElementById(seccionId);
            if (!pagina) return;
            pagina.classList.add('activa');
            if (typeof generarCuestionario === 'function') generarCuestionario(seccionId, _scrollAPregunta);
        }

        // Mostrar botón flotante
        var btn = document.getElementById('btn-volver-buscador');
        if (btn) btn.style.display = 'flex';
    };

    // ── Resaltar texto buscado en amarillo dentro del bloque ──
    function _resaltarTextoBuscado(bloque, query) {
        if (!query || query.length < 2) return;
        // Limpiar highlights anteriores en toda la sección
        var pagina = bloque.closest('.pagina-cuestionario');
        if (pagina) {
            pagina.querySelectorAll('.buscador-texto-highlight').forEach(function(el) {
                var parent = el.parentNode;
                parent.replaceChild(document.createTextNode(el.textContent), el);
                parent.normalize();
            });
        }
        var queryLower = normalizarTexto(query);
        // Recorrer todos los nodos de texto dentro del bloque
        var walker = document.createTreeWalker(bloque, NodeFilter.SHOW_TEXT, null, false);
        var nodos = [];
        var node;
        while ((node = walker.nextNode())) nodos.push(node);
        nodos.forEach(function(textNode) {
            var text = textNode.textContent;
            var textNorm = normalizarTexto(text);
            var idx = textNorm.indexOf(queryLower);
            if (idx === -1) return;
            // Reconstruir el nodo con el tramo resaltado
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

    // ── Volver al buscador conservando la búsqueda y posición de scroll ──
    window.volverAlBuscador = function () {
        try { sessionStorage.removeItem('buscador_origen'); } catch(e) {}
        if (typeof navegacionOrigen !== 'undefined') navegacionOrigen = null;
        var btn = document.getElementById('btn-volver-buscador');
        if (btn) btn.style.display = 'none';

        ocultarTodo();
        var panel = document.getElementById('buscador-preguntas');
        if (panel) panel.classList.remove('oculto');

        renderNavBar();

        var q = '';
        try { q = localStorage.getItem(BUSCADOR_KEY) || ''; } catch(e) {}
        var inp = document.getElementById('buscador-input');
        if (inp) inp.value = q;

        // Obtener el card al que se fue antes de buscar (puede cambiar después del render)
        var savedScrollBuscador = 0;
        var lastCard = '';
        try {
            savedScrollBuscador = parseInt(localStorage.getItem('buscador_scroll_pos') || '0', 10);
            lastCard = localStorage.getItem('buscador_last_card') || '';
        } catch(e) {}

        // Función que intenta hacer scroll al card, con reintentos
        function _scrollAlCard(cardId, intentos) {
            var cardEl = cardId ? document.querySelector('[data-buscador-card-id="' + cardId + '"]') : null;
            if (cardEl) {
                cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                cardEl.style.transition = 'box-shadow .3s, outline .3s';
                cardEl.style.outline = '3px solid #0891b2';
                cardEl.style.boxShadow = '0 0 0 5px rgba(8,145,178,0.18)';
                setTimeout(function() {
                    cardEl.style.outline = '';
                    cardEl.style.boxShadow = '';
                }, 2200);
            } else if (intentos > 0) {
                // Aún no está en el DOM, reintentar
                setTimeout(function() { _scrollAlCard(cardId, intentos - 1); }, 150);
            } else {
                // Fallback: scroll numérico
                window.scrollTo({ top: savedScrollBuscador, behavior: 'smooth' });
            }
        }

        if (q.length >= 2) {
            // Ejecutar búsqueda; cuando termine el DOM se actualiza y entonces hacemos scroll
            realizarBusqueda(q);
            // Usar MutationObserver para detectar cuando se rendericen los cards
            var resDiv = document.getElementById('buscador-resultados');
            if (resDiv && lastCard) {
                var intentosDirect = 0;
                var observerTimeout = null;
                var obs = new MutationObserver(function(mutations) {
                    intentosDirect++;
                    var cardEl = document.querySelector('[data-buscador-card-id="' + lastCard + '"]');
                    if (cardEl || intentosDirect > 20) {
                        obs.disconnect();
                        if (observerTimeout) clearTimeout(observerTimeout);
                        _scrollAlCard(lastCard, 0);
                    }
                });
                obs.observe(resDiv, { childList: true, subtree: true });
                // Seguridad: si en 3s no encontró nada, cancelar observer y hacer scroll numérico
                observerTimeout = setTimeout(function() {
                    obs.disconnect();
                    _scrollAlCard(lastCard, 3);
                }, 3000);
            }
        } else {
            // Sin query: fallback scroll
            requestAnimationFrame(function() {
                requestAnimationFrame(function() {
                    window.scrollTo({ top: savedScrollBuscador, behavior: 'smooth' });
                });
            });
        }
    };

    // ── Buscar y renderizar resultados ──
    window.realizarBusqueda = function (query) {
        query = (query || '').trim();
        var resDiv = document.getElementById('buscador-resultados');
        var statsDiv = document.getElementById('buscador-stats');

        // Guardar query en localStorage
        try {
            if (query.length >= 2) localStorage.setItem(BUSCADOR_KEY, query);
            else localStorage.removeItem(BUSCADOR_KEY);
        } catch(e) {}

        if (query.length < 2) { resDiv.innerHTML = ''; statsDiv.style.display = 'none'; return; }

        if (typeof preguntasPorSeccion === 'undefined') {
            resDiv.innerHTML = '<div class="buscador-vacio"><div class="buscador-vacio-icon">\u26a0\ufe0f</div>No se encontr\u00f3 la base de preguntas.</div>';
            return;
        }

        var TODAS_SECCIONES = [
            'iarsep2020','iaroct2020','iarnov2020','iardic2020',
            'iarfeb2021','iarmar2021','iarabr2021','iarmay2021','iarjun2021','iarago2021','iarsep2021','iarnov2021','iardic2021',
            'iarmar2022','iarabr2022','iarjun2022','iarago2022','iaroct2022','iardic2022',
            'iarmar2023','iarabr2023','iarmay2023','iarjun2023','iarago2023','iaroct2023','iardic2023',
            'iarmar2024','iarabr2024','iarmay2024','iarjun2024','iarago2024','iarsep2024','iaroct2024','iarnov2024','iardic2024',
            'iarfeb2025','iarmar2025','iarabr2025','iarjun2025','iarsep2025','iaroct2025','iarnov2025','iardic2025',
            'iarfeb2026'
        ];

        // Detectar cuáles secciones faltan cargar
        var seccionesFaltantes = TODAS_SECCIONES.filter(function(sid) {
            return !Array.isArray(preguntasPorSeccion[sid]) || preguntasPorSeccion[sid].length === 0;
        });

        if (seccionesFaltantes.length > 0 && window.cargarSeccionFirestore) {
            resDiv.innerHTML = '<div class="buscador-vacio"><div class="buscador-vacio-icon">⏳</div>Cargando base de preguntas para buscar (' + (TODAS_SECCIONES.length - seccionesFaltantes.length) + '/' + TODAS_SECCIONES.length + ')...</div>';
            statsDiv.style.display = 'none';

            // Cargar todas las faltantes en paralelo
            Promise.all(seccionesFaltantes.map(function(sid) {
                return window.cargarSeccionFirestore(sid).then(function(pregs) {
                    if (pregs) preguntasPorSeccion[sid] = pregs;
                    // Si falla (usuario demo sin permiso), simplemente no se carga
                }).catch(function() {});
            })).then(function() {
                _ejecutarBusqueda(query, resDiv, statsDiv);
            });
            return;
        }

        _ejecutarBusqueda(query, resDiv, statsDiv);
    };

    function _ejecutarBusqueda(query, resDiv, statsDiv) {
        var queryNorm = normalizarTexto(query);
        var resE = [], resO = [];

        // Orden cronológico de secciones (de más viejo a más nuevo)
        var ORDEN_SECCIONES = [
            'iarsep2020','iaroct2020','iarnov2020','iardic2020',
            'iarfeb2021','iarmar2021','iarabr2021','iarmay2021','iarjun2021','iarago2021','iarsep2021','iarnov2021','iardic2021',
            'iarmar2022','iarabr2022','iarjun2022','iarago2022','iaroct2022','iardic2022',
            'iarmar2023','iarabr2023','iarmay2023','iarjun2023','iarago2023','iaroct2023','iardic2023',
            'iarmar2024','iarabr2024','iarmay2024','iarjun2024','iarago2024','iarsep2024','iaroct2024','iarnov2024','iardic2024',
            'iarfeb2025','iarmar2025','iarabr2025','iarjun2025','iarsep2025','iaroct2025','iarnov2025','iardic2025',
            'iarfeb2026'
        ];

        Object.keys(preguntasPorSeccion).forEach(function (sid) {
            var preguntas = preguntasPorSeccion[sid];
            if (!Array.isArray(preguntas)) return;
            var examen = nombreExamen(sid);
            preguntas.forEach(function (preg, idx) {
                if (preg.pregunta && normalizarTexto(preg.pregunta).includes(queryNorm)) {
                    resE.push({ sid:sid, idx:idx, examen:examen, num:idx+1, texto:preg.pregunta });
                }
                if (Array.isArray(preg.opciones)) {
                    preg.opciones.forEach(function (opc, oi) {
                        if (normalizarTexto(opc).includes(queryNorm)) {
                            resO.push({ sid:sid, idx:idx, examen:examen, num:idx+1,
                                letra:String.fromCharCode(65+oi), texto:opc, enunciado:preg.pregunta });
                        }
                    });
                }
            });
        });

        // Ordenar de más reciente a más antigua usando ORDEN_SECCIONES como referencia
        function sortDesc(a, b) {
            var ia = ORDEN_SECCIONES.indexOf(a.sid);
            var ib = ORDEN_SECCIONES.indexOf(b.sid);
            // Secciones no reconocidas (simulacro, etc.) van al final
            if (ia === -1) ia = 9999;
            if (ib === -1) ib = 9999;
            return ib - ia;
        }
        resE.sort(sortDesc);
        resO.sort(sortDesc);

        var total = resE.length + resO.length;
        statsDiv.style.display = 'block';
        statsDiv.textContent = total === 0
            ? 'No se encontraron resultados para "' + query + '"'
            : total + ' resultado' + (total!==1?'s':'') + ' encontrado' + (total!==1?'s':'') +
              ' (' + resE.length + ' en enunciados \u00b7 ' + resO.length + ' en opciones)' +
              '  \u2014  Hac\u00e9 clic en una tarjeta para ir a la pregunta';

        if (total === 0) {
            resDiv.innerHTML = '<div class="buscador-vacio"><div class="buscador-vacio-icon">\ud83d\udd0d</div>' +
                'No se encontraron resultados con <strong>"' + escapeHtml(query) + '"</strong></div>';
            return;
        }

        var html = '';

        // Cargar visitadas para aplicar estilo
        var visited = {};
        try { visited = JSON.parse(localStorage.getItem('buscador_visited_v1') || '{}'); } catch(e) {}

        function _esBloqueadaDemo(sid) {
            return window._demoCheckEnabled && window._demoSeccionesPermitidas &&
                   !window._demoSeccionesPermitidas.includes(sid);
        }

        if (resE.length > 0) {
            html += '<div class="buscador-grupo-titulo enunciado">\ud83d\udcc4 Encontrado en Enunciados (' + resE.length + ')</div>';
            resE.forEach(function(r) {
                var cardId = r.sid + '_' + r.idx;
                var bloqueada = _esBloqueadaDemo(r.sid);
                var visitadaClass = (!bloqueada && visited[cardId]) ? ' buscador-card-visitada' : '';
                var demoClass = bloqueada ? ' buscador-card-demo-restringida' : '';
                html += '<div class="buscador-card tipo-enunciado' + visitadaClass + demoClass + '" data-buscador-card-id="' + cardId + '" onclick="irAPreguntaDesdeBuscador(\'' + r.sid + '\',' + r.idx + ')" title="Ir a esta pregunta">' +
                    '<div class="buscador-card-meta">' +
                        '<span class="badge-tipo enunciado">Enunciado</span>' +
                        '<span class="badge-examen">IAR ' + escapeHtml(r.examen) + '</span>' +
                        '<span class="badge-pregunta">Pregunta N\u00b0 ' + r.num + '</span>' +
                        (!bloqueada && visited[cardId] ? '<span class="badge-visitada">\u2713 Visitada</span>' : '') +
                        (bloqueada ? '<span class="badge-demo-lock">\ud83d\udd12 Solo DEMO</span>' : '') +
                        (!bloqueada ? '<span class="badge-ir">\u2192 Ir a la pregunta</span>' : '') +
                    '</div>' +
                    '<div class="buscador-card-texto">' + resaltarTexto(truncar(r.texto, 280), query) + '</div>' +
                '</div>';
            });
        }

        if (resO.length > 0) {
            html += '<div class="buscador-grupo-titulo opcion">\ud83d\udd18 Encontrado en Opciones (' + resO.length + ')</div>';
            resO.forEach(function(r) {
                var enunciadoCorto = truncar(r.enunciado || '', 200);
                var cardId = r.sid + '_' + r.idx;
                var bloqueada = _esBloqueadaDemo(r.sid);
                var visitadaClass = (!bloqueada && visited[cardId]) ? ' buscador-card-visitada' : '';
                var demoClass = bloqueada ? ' buscador-card-demo-restringida' : '';
                html += '<div class="buscador-card tipo-opcion' + visitadaClass + demoClass + '" data-buscador-card-id="' + cardId + '" onclick="irAPreguntaDesdeBuscador(\'' + r.sid + '\',' + r.idx + ')" title="Ir a esta pregunta">' +
                    '<div class="buscador-card-meta">' +
                        '<span class="badge-tipo opcion">Opci\u00f3n</span>' +
                        '<span class="badge-examen">IAR ' + escapeHtml(r.examen) + '</span>' +
                        '<span class="badge-pregunta">Pregunta N\u00b0 ' + r.num + '</span>' +
                        (!bloqueada && visited[cardId] ? '<span class="badge-visitada">\u2713 Visitada</span>' : '') +
                        (bloqueada ? '<span class="badge-demo-lock">\ud83d\udd12 Solo DEMO</span>' : '') +
                        (!bloqueada ? '<span class="badge-ir">\u2192 Ir a la pregunta</span>' : '') +
                    '</div>' +
                    '<div class="buscador-card-texto">' + resaltarTexto(r.texto, query) + '</div>' +
                    (enunciadoCorto ? '<div class="buscador-card-enunciado-ref">\ud83d\udccb Enunciado: ' + escapeHtml(enunciadoCorto) + '</div>' : '') +
                '</div>';
            });
        }

        // Si es usuario demo, mostrar aviso de contenido adicional bloqueado
        if (window._demoCheckEnabled && window._demoSeccionesPermitidas) {
            var seccionesNoDisponibles = ORDEN_SECCIONES.filter(function(sid) {
                return !window._demoSeccionesPermitidas.includes(sid) &&
                       (!Array.isArray(preguntasPorSeccion[sid]) || preguntasPorSeccion[sid].length === 0);
            });
            if (seccionesNoDisponibles.length > 0) {
                html += '<div class="buscador-demo-aviso">' +
                    '🔒 Hay <strong>' + seccionesNoDisponibles.length + ' exámenes adicionales</strong> con resultados bloqueados. ' +
                    'Accedé al plan completo para buscar en toda la base de preguntas.' +
                    '</div>';
            }
        }

        resDiv.innerHTML = html;
    } // fin _ejecutarBusqueda

})();

/* ============================================================
   TIMER SIMULACRO IAR — 1 hora 30 minutos
   - Solo activo en seccion simulacro_iar
   - Notificaciones toast a los 30, 15, 5, 1 minuto restantes
   - Al expirar: califica todas las pendientes y muestra resultado
   ============================================================ */
(function () {

  var SIMULACRO_TIMER_KEY  = 'simulacro_iar_timer_end_v1'; // timestamp ISO de fin
  var SIMULACRO_DURACION_MS = 90 * 60 * 1000; // 1h 30min en ms

  var _timerId       = null;  // setInterval del reloj
  var _toastTimeouts = [];    // setTimeout de toasts programados
  var _timerActivo   = false;

  // ── Inyectar estilos CSS una sola vez ──────────────────────────────
  function _inyectarCSS() {
    if (document.getElementById('sim-timer-styles')) return;
    var style = document.createElement('style');
    style.id = 'sim-timer-styles';
    style.textContent = [
      /* ── Reloj flotante ── */
      '#sim-timer-widget{',
        'position:fixed;top:16px;right:16px;z-index:10000;',
        'display:flex;align-items:center;gap:8px;',
        'background:rgba(15,23,42,0.92);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);',
        'border:1px solid rgba(255,255,255,0.12);border-radius:40px;',
        'padding:8px 16px 8px 12px;',
        'box-shadow:0 8px 32px rgba(0,0,0,0.35),0 0 0 1px rgba(255,255,255,0.04);',
        'font-family:"SF Mono","Fira Code","Consolas",monospace;',
        'transition:all 0.4s cubic-bezier(.4,0,.2,1);',
        'cursor:default;user-select:none;',
      '}',
      '#sim-timer-widget.urgente{',
        'background:rgba(185,28,28,0.95);',
        'border-color:rgba(254,202,202,0.3);',
        'animation:sim-pulse-red 1s ease-in-out infinite;',
      '}',
      '#sim-timer-widget.advertencia{',
        'background:rgba(120,53,15,0.95);',
        'border-color:rgba(253,186,116,0.3);',
      '}',
      '#sim-timer-dot{',
        'width:8px;height:8px;border-radius:50%;',
        'background:#22c55e;flex-shrink:0;',
        'box-shadow:0 0 6px #22c55e;',
        'animation:sim-blink 2s ease-in-out infinite;',
      '}',
      '#sim-timer-widget.urgente #sim-timer-dot{background:#fca5a5;box-shadow:0 0 8px #fca5a5;}',
      '#sim-timer-widget.advertencia #sim-timer-dot{background:#fb923c;box-shadow:0 0 6px #fb923c;}',
      '#sim-timer-label{font-size:10px;color:rgba(255,255,255,0.45);letter-spacing:0.06em;text-transform:uppercase;}',
      '#sim-timer-display{',
        'font-size:1.05rem;font-weight:700;letter-spacing:0.04em;',
        'color:#f8fafc;min-width:52px;text-align:center;',
        'text-shadow:0 1px 4px rgba(0,0,0,0.4);',
      '}',
      /* ── Toast ── */
      '.sim-toast{',
        'position:fixed;left:50%;transform:translateX(-50%) translateY(-24px);',
        'z-index:10100;',
        'display:flex;align-items:center;gap:12px;',
        'padding:14px 22px;border-radius:14px;',
        'box-shadow:0 16px 48px rgba(0,0,0,0.28),0 4px 12px rgba(0,0,0,0.18);',
        'font-family:"Segoe UI","Helvetica Neue",Arial,sans-serif;',
        'max-width:92vw;width:max-content;',
        'opacity:0;',
        'transition:opacity 0.45s cubic-bezier(.4,0,.2,1), transform 0.45s cubic-bezier(.4,0,.2,1);',
        'pointer-events:none;',
      '}',
      '.sim-toast.visible{opacity:1;transform:translateX(-50%) translateY(0);}',
      '.sim-toast-icon{font-size:1.5rem;line-height:1;flex-shrink:0;}',
      '.sim-toast-body{display:flex;flex-direction:column;gap:2px;}',
      '.sim-toast-titulo{font-size:.95rem;font-weight:700;line-height:1.3;}',
      '.sim-toast-subtitulo{font-size:.8rem;opacity:0.82;line-height:1.4;}',
      '.sim-toast.verde{background:linear-gradient(135deg,#14532d 0%,#166534 100%);color:#dcfce7;border:1px solid rgba(134,239,172,0.25);}',
      '.sim-toast.amarillo{background:linear-gradient(135deg,#713f12 0%,#854d0e 100%);color:#fef9c3;border:1px solid rgba(253,224,71,0.25);}',
      '.sim-toast.naranja{background:linear-gradient(135deg,#7c2d12 0%,#9a3412 100%);color:#ffedd5;border:1px solid rgba(253,186,116,0.25);}',
      '.sim-toast.rojo{background:linear-gradient(135deg,#7f1d1d 0%,#991b1b 100%);color:#fee2e2;border:1px solid rgba(252,165,165,0.25);}',
      /* ── Overlay tiempo agotado ── */
      '#sim-timeout-overlay{',
        'position:fixed;top:0;left:0;width:100%;height:100%;',
        'background:rgba(0,0,0,0.72);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);',
        'z-index:10200;display:flex;align-items:center;justify-content:center;',
        'animation:sim-fadein 0.5s ease;',
      '}',
      '#sim-timeout-card{',
        'background:#fff;border-radius:20px;padding:36px 32px;',
        'max-width:440px;width:92vw;text-align:center;',
        'box-shadow:0 32px 80px rgba(0,0,0,0.35);',
        'animation:sim-slidein 0.5s cubic-bezier(.4,0,.2,1);',
      '}',
      /* ── Keyframes ── */
      '@keyframes sim-blink{0%,100%{opacity:1}50%{opacity:.35}}',
      '@keyframes sim-pulse-red{0%,100%{box-shadow:0 8px 32px rgba(0,0,0,0.35),0 0 0 0 rgba(239,68,68,0)}50%{box-shadow:0 8px 32px rgba(0,0,0,0.35),0 0 0 8px rgba(239,68,68,0.25)}}',
      '@keyframes sim-fadein{from{opacity:0}to{opacity:1}}',
      '@keyframes sim-slidein{from{transform:translateY(32px);opacity:0}to{transform:translateY(0);opacity:1}}',
    ].join('');
    document.head.appendChild(style);
  }

  // ── Crear / obtener el widget de reloj ────────────────────────────
  function _crearWidget() {
    if (document.getElementById('sim-timer-widget')) return;
    var w = document.createElement('div');
    w.id = 'sim-timer-widget';
    w.innerHTML =
      '<span id="sim-timer-dot"></span>' +
      '<span id="sim-timer-label">TIEMPO</span>' +
      '<span id="sim-timer-display">--:--</span>';
    document.body.appendChild(w);
  }

  function _destruirWidget() {
    var w = document.getElementById('sim-timer-widget');
    if (w) w.remove();
  }

  function _actualizarWidget(msRestantes) {
    var w = document.getElementById('sim-timer-widget');
    var d = document.getElementById('sim-timer-display');
    if (!w || !d) return;

    var totalSeg  = Math.max(0, Math.ceil(msRestantes / 1000));
    var horas     = Math.floor(totalSeg / 3600);
    var minutos   = Math.floor((totalSeg % 3600) / 60);
    var segundos  = totalSeg % 60;

    var texto = horas > 0
      ? horas + ':' + _z(minutos) + ':' + _z(segundos)
      : _z(minutos) + ':' + _z(segundos);
    d.textContent = texto;

    // Cambiar color del widget según urgencia
    w.classList.remove('urgente','advertencia');
    if (msRestantes <= 60 * 1000)        w.classList.add('urgente');
    else if (msRestantes <= 5 * 60 * 1000) w.classList.add('advertencia');
  }

  function _z(n) { return n < 10 ? '0' + n : '' + n; }

  // ── Toast de aviso ────────────────────────────────────────────────
  function _mostrarToast(color, icono, titulo, subtitulo) {
    var toast = document.createElement('div');
    toast.className = 'sim-toast ' + color;
    // Calcular posición vertical: debajo del header si existe, sino 20px
    var topPx = 20;
    var header = document.querySelector('header, .header, nav, .navbar');
    if (header) topPx = header.getBoundingClientRect().bottom + 12;
    toast.style.top = topPx + 'px';
    toast.innerHTML =
      '<div class="sim-toast-icon">' + icono + '</div>' +
      '<div class="sim-toast-body">' +
        '<div class="sim-toast-titulo">' + titulo + '</div>' +
        '<div class="sim-toast-subtitulo">' + subtitulo + '</div>' +
      '</div>';
    document.body.appendChild(toast);

    // Animar entrada
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        toast.classList.add('visible');
      });
    });

    // Duración visible: 6 segundos (legible sin ser molesto)
    var duracion = 6000;
    setTimeout(function() {
      toast.classList.remove('visible');
      setTimeout(function() { if (toast.parentNode) toast.remove(); }, 500);
    }, duracion);
  }

  // ── Programar toasts según tiempo restante ────────────────────────
  function _programarToasts(msRestantes) {
    // Limpiar toasts anteriores si hubiera
    _toastTimeouts.forEach(function(id) { clearTimeout(id); });
    _toastTimeouts = [];

    var alertas = [
      {
        en: 30 * 60 * 1000, // 30 min restantes
        color: 'verde', icono: '⏱️',
        titulo: 'Quedan 30 minutos',
        subtitulo: 'Vas muy bien — seguí respondiendo con calma.'
      },
      {
        en: 15 * 60 * 1000, // 15 min
        color: 'amarillo', icono: '🕐',
        titulo: 'Quedan 15 minutos',
        subtitulo: 'Revisá las preguntas que te quedaron pendientes.'
      },
      {
        en: 5 * 60 * 1000, // 5 min
        color: 'naranja', icono: '⚠️',
        titulo: '¡Solo 5 minutos!',
        subtitulo: 'Intentá responder las preguntas que te faltan.'
      },
      {
        en: 1 * 60 * 1000, // 1 min
        color: 'rojo', icono: '🔴',
        titulo: '¡Último minuto!',
        subtitulo: 'El simulacro se cerrará automáticamente en 60 segundos.'
      }
    ];

    alertas.forEach(function(alerta) {
      var delay = msRestantes - alerta.en;
      if (delay < 0) return; // ya pasó ese momento
      var id = setTimeout(function() {
        if (!_timerActivo) return;
        _mostrarToast(alerta.color, alerta.icono, alerta.titulo, alerta.subtitulo);
      }, delay);
      _toastTimeouts.push(id);
    });
  }

  // ── Forzar respuesta de todas las preguntas pendientes ────────────
  function _finalizarSimulacroForzado() {
    _timerActivo = false;
    if (_timerId) { clearInterval(_timerId); _timerId = null; }
    _toastTimeouts.forEach(function(id) { clearTimeout(id); });
    _toastTimeouts = [];
    _destruirWidget();
    localStorage.removeItem(SIMULACRO_TIMER_KEY);

    var preguntas = (typeof preguntasPorSeccion !== 'undefined')
      ? (preguntasPorSeccion['simulacro_iar'] || [])
      : [];

    // Contar sin responder
    var sinResponder = 0;
    var s = (typeof state !== 'undefined') ? state['simulacro_iar'] : null;

    preguntas.forEach(function(preg, idx) {
      if (!s || !s.graded || !s.graded[idx]) {
        sinResponder++;
        // Marcar como incorrecta (sin respuesta)
        if (!window.puntajesPorSeccion) window.puntajesPorSeccion = {};
        if (!window.puntajesPorSeccion['simulacro_iar']) {
          window.puntajesPorSeccion['simulacro_iar'] = Array(preguntas.length).fill(null);
        }
        if (window.puntajesPorSeccion['simulacro_iar'][idx] === null ||
            window.puntajesPorSeccion['simulacro_iar'][idx] === undefined) {
          window.puntajesPorSeccion['simulacro_iar'][idx] = 0;
        }
        // Marcar visualmente en el DOM
        var puntajeElem = document.getElementById('puntaje-simulacro_iar-' + idx);
        if (puntajeElem && puntajeElem.textContent === '') {
          puntajeElem.textContent = '⏰ Sin responder (0)';
          puntajeElem.style.color = '#94a3b8';
        }
        // Deshabilitar inputs
        var inputs = Array.from(document.getElementsByName('preguntasimulacro_iar' + idx));
        inputs.forEach(function(inp) { inp.disabled = true; });
        var btn = inputs.length > 0 && inputs[0].closest
          ? inputs[0].closest('.pregunta')?.querySelector('button.btn-responder')
          : null;
        if (btn) btn.disabled = true;
        // Guardar en state
        if (s) {
          if (!s.graded) s.graded = {};
          s.graded[idx] = true;
          if (!s.answers) s.answers = {};
          if (!s.answers[idx]) s.answers[idx] = [];
        }
      }
    });

    // Guardar estado
    if (typeof saveJSON === 'function' && typeof state !== 'undefined' && state['simulacro_iar']) {
      try { saveJSON('quiz_state_v3', state); } catch(e) {}
    }

    // Calcular puntaje total
    var totalScore = 0;
    if (window.puntajesPorSeccion && window.puntajesPorSeccion['simulacro_iar']) {
      window.puntajesPorSeccion['simulacro_iar'].forEach(function(p) { totalScore += (p || 0); });
    }

    // Mostrar overlay de tiempo agotado
    _mostrarOverlayTimeout(totalScore, preguntas.length, sinResponder);
  }

  // ── Overlay final de tiempo agotado ──────────────────────────────
  function _mostrarOverlayTimeout(score, total, sinResponder) {
    // Registrar intento si aún no se registró
    if (typeof mostrarResultadoFinal === 'function') {
      try { mostrarResultadoFinal('simulacro_iar'); } catch(e) {}
    }

    var overlay = document.createElement('div');
    overlay.id = 'sim-timeout-overlay';

    var pct = total > 0 ? Math.round((score / total) * 100) : 0;
    var emoji = pct >= 70 ? '🎉' : pct >= 50 ? '👍' : '📚';
    var colorScore = pct >= 70 ? '#15803d' : pct >= 50 ? '#b45309' : '#b91c1c';
    var respondidas = total - sinResponder;

    overlay.innerHTML =
      '<div id="sim-timeout-card">' +
        '<div style="font-size:2.4rem;margin-bottom:8px;">⏰</div>' +
        '<div style="font-size:1.25rem;font-weight:800;color:#1e293b;margin-bottom:4px;">¡Tiempo agotado!</div>' +
        '<div style="font-size:.88rem;color:#64748b;margin-bottom:24px;line-height:1.6;">' +
          'El simulacro finalizó automáticamente al completarse 1 hora 30 minutos.' +
        '</div>' +
        '<div style="background:#f8fafc;border-radius:12px;padding:18px 20px;margin-bottom:20px;border:1px solid #e2e8f0;">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;text-align:center;">' +
            '<div>' +
              '<div style="font-size:1.9rem;font-weight:800;color:' + colorScore + ';">' + score + '</div>' +
              '<div style="font-size:.72rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-top:2px;">Correctas</div>' +
            '</div>' +
            '<div>' +
              '<div style="font-size:1.9rem;font-weight:800;color:#334155;">' + total + '</div>' +
              '<div style="font-size:.72rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-top:2px;">Total</div>' +
            '</div>' +
            '<div>' +
              '<div style="font-size:1.9rem;font-weight:800;color:#64748b;">' + sinResponder + '</div>' +
              '<div style="font-size:.72rem;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-top:2px;">Sin responder</div>' +
            '</div>' +
          '</div>' +
          '<div style="margin-top:14px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:.85rem;color:#475569;">' +
            emoji + ' Respondiste <strong>' + respondidas + ' de ' + total + '</strong> preguntas &nbsp;·&nbsp; ' +
            '<strong style="color:' + colorScore + ';">' + pct + '%</strong> de aciertos' +
          '</div>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:9px;">' +
          '<button id="sim-to-salir" style="padding:12px 18px;background:linear-gradient(135deg,#1e3a8a,#1e40af);color:#fff;border:none;border-radius:10px;font-size:.93rem;font-weight:600;cursor:pointer;letter-spacing:.02em;">🏠 Volver al menú principal</button>' +
          '<button id="sim-to-reiniciar" style="padding:12px 18px;background:#f1f5f9;color:#334155;border:1px solid #e2e8f0;border-radius:10px;font-size:.93rem;font-weight:600;cursor:pointer;">🔄 Reiniciar con las mismas preguntas</button>' +
          '<button id="sim-to-nuevo" style="padding:12px 18px;background:#f1f5f9;color:#334155;border:1px solid #e2e8f0;border-radius:10px;font-size:.93rem;font-weight:600;cursor:pointer;">🎲 Crear nuevo simulacro</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    document.getElementById('sim-to-salir').onclick = function() {
      overlay.remove();
      if (typeof _limpiarSimulacroIARSinProgreso === 'function') _limpiarSimulacroIARSinProgreso();
      window.location.href = 'https://examenesiaruba.github.io/#menu';
    };

    document.getElementById('sim-to-reiniciar').onclick = function() {
      overlay.remove();
      if (typeof window.reiniciarSimulacroIAR === 'function') window.reiniciarSimulacroIAR();
    };

    document.getElementById('sim-to-nuevo').onclick = function() {
      overlay.remove();
      if (typeof window.crearNuevoSimulacroIAR === 'function') window.crearNuevoSimulacroIAR();
    };
  }

  // ── Arrancar el timer ─────────────────────────────────────────────
  function iniciarTimer() {
    if (_timerActivo) return;
    _inyectarCSS();
    _crearWidget();
    _timerActivo = true;

    // Calcular tiempo de fin (reutilizar si hay uno guardado en progreso)
    var finGuardado = null;
    try { finGuardado = localStorage.getItem(SIMULACRO_TIMER_KEY); } catch(e) {}
    var finMs;
    if (finGuardado) {
      finMs = parseInt(finGuardado, 10);
      // Si ya expiró mientras estaba fuera, finalizar de inmediato
      if (finMs <= Date.now()) {
        localStorage.removeItem(SIMULACRO_TIMER_KEY);
        setTimeout(function() { _finalizarSimulacroForzado(); }, 300);
        return;
      }
    } else {
      finMs = Date.now() + SIMULACRO_DURACION_MS;
      try { localStorage.setItem(SIMULACRO_TIMER_KEY, String(finMs)); } catch(e) {}
    }

    // Programar toasts desde el tiempo restante actual
    _programarToasts(finMs - Date.now());

    // Tick cada segundo
    _timerId = setInterval(function() {
      if (!_timerActivo) { clearInterval(_timerId); return; }
      var restantes = finMs - Date.now();
      _actualizarWidget(restantes);
      if (restantes <= 0) {
        clearInterval(_timerId);
        _timerId = null;
        _finalizarSimulacroForzado();
      }
    }, 1000);

    // Mostrar display inicial sin esperar el primer segundo
    _actualizarWidget(finMs - Date.now());
  }

  // ── Detener el timer (al salir del simulacro) ─────────────────────
  function detenerTimer() {
    _timerActivo = false;
    if (_timerId) { clearInterval(_timerId); _timerId = null; }
    _toastTimeouts.forEach(function(id) { clearTimeout(id); });
    _toastTimeouts = [];
    _destruirWidget();
    // NO borrar SIMULACRO_TIMER_KEY — se necesita para restaurar si vuelve
  }

  // ── Limpiar timer definitivamente (al reiniciar o crear nuevo) ────
  function limpiarTimer() {
    detenerTimer();
    try { localStorage.removeItem(SIMULACRO_TIMER_KEY); } catch(e) {}
  }

  // ── Exponer API pública ───────────────────────────────────────────
  window._simulacroTimer = {
    iniciar: iniciarTimer,
    detener: detenerTimer,
    limpiar: limpiarTimer
  };

  // ── Hooks: conectar con el ciclo de vida del simulacro ────────────
  // Esperar a DOMContentLoaded y luego interceptar las funciones clave
  function _hookearFunciones() {
    // 1. Al generar el cuestionario del simulacro → arrancar el timer
    var _origGenerarCuestionario = window.generarCuestionario;
    // generarCuestionario es una función interna del IIFE — no está expuesta en window.
    // En su lugar, hookeamos inicializarSimulacroIAR y crearNuevoSimulacroIAR.

    // 2. Iniciar timer cuando se inicializa el simulacro
    var _origInicializar = window.inicializarSimulacroIAR;
    window.inicializarSimulacroIAR = function() {
      if (typeof _origInicializar === 'function') _origInicializar.apply(this, arguments);
      // Dar un pequeño margen para que el cuestionario se renderice
      setTimeout(function() {
        // Solo arrancar si la sección simulacro_iar está realmente visible (clase 'activa')
        var simPage = document.getElementById('simulacro_iar');
        if (simPage && simPage.classList.contains('activa')) {
          iniciarTimer();
        }
        // Si no está activa, no iniciar — el hook de showSection lo hará al entrar
      }, 600);
    };

    // Hookear showSection para detectar entrada/salida del simulacro
    var _origShowSection = window.showSection;
    window.showSection = function(seccionId) {
      if (typeof _origShowSection === 'function') _origShowSection.apply(this, arguments);
      if (seccionId === 'simulacro_iar') {
        // Pequeño delay para que el render termine antes de mostrar el widget
        setTimeout(iniciarTimer, 700);
      } else {
        // Salió del simulacro → limpiar timer completamente (resetear contador)
        limpiarTimer();
      }
    };

    // 3. Al salir al menú → limpiar timer SOLO si el usuario confirma la salida.
    // IMPORTANTE: NO llamar limpiarTimer() antes del diálogo — si el usuario elige
    // "No, seguir respondiendo", el timer ya habría sido destruido y el reloj desaparecería.
    var _origVolverMenu = window.volverAlMenu;
    window.volverAlMenu = function() {
      // volverAlMenu llama a confirmarSalidaCuestionario internamente.
      // Interceptamos el resultado: si el usuario confirma, showSection('menu') o showMenu()
      // se encargará de limpiar via el hook de showSection (seccionId !== 'simulacro_iar').
      // Solo necesitamos asegurarnos de no limpiar prematuramente aquí.
      if (typeof _origVolverMenu === 'function') _origVolverMenu.apply(this, arguments);
    };

    var _origVolverSubmenu = window.volverAlSubmenu;
    window.volverAlSubmenu = function() {
      // Mismo razonamiento: no limpiar antes del diálogo de confirmación.
      if (typeof _origVolverSubmenu === 'function') _origVolverSubmenu.apply(this, arguments);
    };

    // 4. Al reiniciar o crear nuevo → limpiar timer completamente y arrancar uno nuevo
    var _origReiniciar = window.reiniciarSimulacroIAR;
    window.reiniciarSimulacroIAR = function() {
      limpiarTimer();
      if (typeof _origReiniciar === 'function') _origReiniciar.apply(this, arguments);
      // Arrancar nuevo timer después de que el diálogo confirme y el cuestionario se regenere
      // (el botón Aceptar del diálogo tarda ~400ms en renderizar el cuestionario)
      setTimeout(iniciarTimer, 1000);
    };

    var _origCrearNuevo = window.crearNuevoSimulacroIAR;
    window.crearNuevoSimulacroIAR = function() {
      limpiarTimer();
      if (typeof _origCrearNuevo === 'function') _origCrearNuevo.apply(this, arguments);
      setTimeout(iniciarTimer, 1000);
    };

    // 5. Al completar el simulacro manualmente → limpiar timer
    var _origMostrarPuntuacion = window.mostrarPuntuacionTotal;
    if (_origMostrarPuntuacion) {
      window.mostrarPuntuacionTotal = function(seccionId) {
        if (seccionId === 'simulacro_iar') limpiarTimer();
        if (typeof _origMostrarPuntuacion === 'function') _origMostrarPuntuacion.apply(this, arguments);
      };
    }
    // También hookeamos el evento DOMContentLoaded del mostrarPuntuacionTotal redefinido
    document.addEventListener('sim-timer-hook-puntuacion', function() {
      limpiarTimer();
    });
  }

  // Si hay timer guardado y estamos en el simulacro al cargar, arrancarlo
  document.addEventListener('DOMContentLoaded', function() {
    _hookearFunciones();

    // Parchear mostrarPuntuacionTotal que se define dentro del otro DOMContentLoaded
    // Usamos un MutationObserver sobre window.mostrarPuntuacionTotal
    var _puntuacionHookInterval = setInterval(function() {
      if (window.mostrarPuntuacionTotal && !window.mostrarPuntuacionTotal._timerHooked) {
        var _orig = window.mostrarPuntuacionTotal;
        window.mostrarPuntuacionTotal = function(seccionId) {
          if (seccionId === 'simulacro_iar') limpiarTimer();
          _orig.apply(this, arguments);
        };
        window.mostrarPuntuacionTotal._timerHooked = true;
        clearInterval(_puntuacionHookInterval);
      }
    }, 200);

    // Si la página carga con hash #simulacro_iar y hay timer guardado → arrancar
    var hash = (window.location.hash || '').replace('#','');
    if (hash === 'simulacro_iar') {
      var finGuardado = null;
      try { finGuardado = localStorage.getItem(SIMULACRO_TIMER_KEY); } catch(e) {}
      if (finGuardado) {
        // Esperar a que el simulacro esté completamente inicializado
        setTimeout(iniciarTimer, 1200);
      }
    }
  });

})();
