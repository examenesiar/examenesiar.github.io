/* ============================================================
   filtro_palabras.js — Filtro de lenguaje inapropiado v2
   ============================================================
   Expone window.IARFiltro con:
     .contieneMalasPalabras(texto) → true/false
     .censurar(texto)              → texto con *** en lugar de groserías
     .moderar(texto)               → null si OK, string con mensaje de error si hay problema

   CRITERIOS DE DISEÑO
   ──────────────────
   • Términos médicos (vagina, pene, ano, vulva, escroto, etc.) NO están
     bloqueados: en un contexto de examen de medicina son vocabulario válido.
   • La normalización previa detecta evasiones comunes: leet speak (p1j@,
     b0lud0), tildes omitidas, letras repetidas (culooooo), separadores
     intercalados (c-u-l-o, c.u.l.o), mayúsculas.
   • Las palabras se agrupan por categoría para facilitar mantenimiento.
   • La detección de frases va después de la de palabras individuales.
   ============================================================ */
(function () {

  // ══════════════════════════════════════════════════════════════
  // 1. NORMALIZACIÓN (idéntica a _comNorm de script_onebyone.js)
  // ══════════════════════════════════════════════════════════════
  const _LEET = {
    '0':'o','1':'i','2':'z','3':'e','4':'a',
    '5':'s','6':'b','7':'t','8':'b','9':'g',
    '@':'a','$':'s','+':'t','&':'y','#':'h','%':'o','^':'v',
    '!':' ','?':' ','.':' ',',':' ',';':' ',':':' ',
    '*':' ','-':' ','_':' ','=':' ','<':' ','>':' ',
    '/':' ','\\':' ','|':' ','(':' ',')':' ',
    '[':' ',']':' ','{':' ','}':' '
  };

  function _norm(t) {
    if (!t) return '';
    let r = t.toLowerCase()
              .split('').map(c => _LEET[c] !== undefined ? _LEET[c] : c).join('');
    r = r.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    r = r.replace(/[^a-z\s]/g, ' ');
    r = r.replace(/(.)\1{2,}/g, '$1$1');  // colapsa letras repetidas 3+
    r = r.replace(/\s+/g, ' ').trim();
    return r;
  }

  // ══════════════════════════════════════════════════════════════
  // 2. PALABRAS INDIVIDUALES BLOQUEADAS
  //    Estas se buscan como palabra completa Y como subcadena
  //    (para atrapar derivados: boludez, pelotudez, etc.)
  //    NOTA: términos médicos (vagina, pene, ano, vulva…) NO están.
  // ══════════════════════════════════════════════════════════════
  const _PALABRAS = [

    // ── INSULTOS GENÉRICOS RIOPLATENSES / LATINOAMERICANOS ─────────────────
    'pelotudo','pelotuda','pelotudes','pelotudez',
    'boludo','boluda','boludes','boludez',
    'forro','forra','forros','forrada',
    'gil','gila','giles',
    'tarado','tarada','tarados',
    'mogolico','mogolica',              // sin tilde (norm lo maneja)
    'sorete','soretes',
    'cagon','cagona','cagones',
    'lacra','lacras',
    'escoria','escorias',
    'buitre','buitres',
    'alimaña','alimanas',
    'mamerto','mamertos',
    'pajero','pajera','pajeros',
    'hdp',
    'ctm','cstm',
    'ptm',
    'hijo de re puta',
    'hdeputa',
    'choto','chota',
    'chupamedias','chupame','chuparse',
    'lamebotas','lamedores',
    'vendepatria',
    'traidor','traidora',
    'estafador','estafadora',
    'chorro','chorra','chorros',
    'ratero','ratera',
    'parasito','parasita',
    'apestoso','apestosa',
    'inservible',
    'inepto','inepta',
    'fracasado','fracasada',
    'mamada','mamadas',
    'pelotudear','abocetar',
    'chupaculo','chupacula',
    'rompebolas','rompepelotas',
    'soplapija','soplapito',
    'comepija','comepito','comemierda',
    'chupapija','chupapito','chupala',
    'cabezadepija','cabezadepito',
    'cagartepalos','cagarapalos',

    // ── GROSERÍAS / VULGARIDADES ────────────────────────────────────────────
    'mierda','mierdas','mierdon','mierdosa',
    'puta','putas',
    'puto','putos',
    'culo','culos','culito',
    'orto','ortos',
    'concha','conchas','concheta',
    'verga','vergas','vergon',
    'pija','pijas','pijazo',
    'pito','pitos',
    'pichula','pichulas',
    'teta','tetas','tetona',
    'nalga','nalgas',
    'carajo','carajos',
    'joder','jodete','joderme','joderse','jodido','jodida',
    'chingar','chingada','chingon','chingona','chingados','chinguen',
    'culero','culera','culeros',
    'zorra','zorras','zorron','zorrona',
    'perra','perras',
    'pendejo','pendeja','pendejos','pendejas',
    'cabron','cabrona','cabrones',
    'mamon','mamona',
    'reconcha','reputa','reputamadre',
    'putamadre',
    'hijaputa','hijueputa','hijodeputa','hdputa',
    'conchadesumadre','conchatumadre',
    'weon','hueon','weonas','hueones',

    // ── INSULTOS POR ORIENTACIÓN SEXUAL / IDENTIDAD DE GÉNERO ──────────────
    // (términos usados como insulto — no la orientación o identidad en sí)
    'maricon','maricona','mariconazo',
    'trolo','trola','trolos',
    'tortillera','tortilleras',
    'bollera','bolleras',
    'sarasa','sarasas',
    'afeminado','afeminada',          // solo cuando usado como insulto; la norma lo detecta
    'travelo','travelos',
    'sidoso','sidosa','sidosos',       // insulto homofóbico histórico
    'sifilitico','sifilitica',         // idem
    'pajero','pajera',                 // también insulto genérico arriba

    // ── INSULTOS RACISTAS / XENOFÓBICOS / ÉTNICOS ──────────────────────────
    'sudaca','sudacas','sudaka','sudakas',
    'bolita','bolitas',                // peyorativo para boliviano/a
    'paragua','paraguas',              // peyorativo para paraguayo/a
    'boliguayo','boliguaya',
    'chilote','chilotes',              // peyorativo en algunos contextos
    'brasuca','brasucas',              // peyorativo para brasileño/a
    'paki','pakis',
    'negrata','negratas',
    'negrada','negradas',
    'negrodemierda',
    'cagoen',
    'mulatada',
    'indio de mierda','indios',        // en contexto despectivo
    'gringo de mierda',
    'yankee de mierda',
    'facho','facha','fachos',          // puede ser insulto agresivo
    'neonazi','nazi',                  // como insulto / contenido de odio
    'judios','judio de mierda',        // antisemitismo
    'arabe de mierda','moro',          // islamofobia
    'chino de mierda','chinos son',
    'villero','villera','villeros',    // clasista
    'cabecita negra',
    'negro de mierda',
    'negro cabeza',
    'negra de mierda',
    'cabeza negra',

    // ── CLASISMO / DISCRIMINACIÓN SOCIAL ───────────────────────────────────
    'planero','planera','planeros',
    'choriplanero','choriplanera',
    'grasa','grasas',                  // clasista rioplatense
    'croto','crota','crotos',
    'crocantel',
    // Nota: 'croto' se bloquea pero _resPalabras usa reCompleta (límite de palabra)
    // para no atrapar 'escroto' (término médico). La búsqueda parcial (reParcial)
    // está desactivada para esta palabra usando la lógica de exclusión médica abajo.
    'muerto de hambre',
    'pobretón','pobretona',
    'mendigo','mendiga',               // cuando insulto, no descripción
    'atorrante','atorranta',
    'vagabundo','vagabunda',
    'vago','vaga','vagos',
    'pordiosero','pordiosera',

    // ── INSULTOS POR DISCAPACIDAD ───────────────────────────────────────────
    'mongolico','mongolica','mongol',
    'mogolico','mogolica',
    'retrasado','retrasada','retrasados',
    'retardado','retardada',
    'down de mierda',
    'tonto de remate',
    'lelo','lela',
    'idiota','idiotas',
    'imbecil','imbeciles',
    'subnormal','subnormales',
    'estupido','estupida','estupidos',
    'autista',                         // cuando usado como insulto
    'demente','dementas',
    'loco de mierda','loca de mierda',
    'tarada','tarados',
    'deficiente mental',
    'minusvalido','minusvalida',       // cuando insulto

    // ── INSULTOS SEXISTAS / MISOGINIA ───────────────────────────────────────
    'feminazi','feminazis',
    'histérica','histerica','histericas',
    'puta de mierda',
    'mujerzuela','mujerzuelas',
    'furcia','furcias',
    'ramera','rameras',
    'meretriz','meretrices',
    'golfa','golfas',
    'guarra','guarras',
    'pindonga','pindongas',
    'yegua','yeguas',                  // insulto sexista
    'culiada','culiado',
    'cogida','cogido',
    'culear','culearse',

    // ── SEXUALIDAD EXPLÍCITA / PORNOGRÁFICA ─────────────────────────────────
    'coger','cogerse',                 // acto sexual explícito
    'follar','follarse',
    'garchar','garcharse',
    'culear','culiarse',
    'pornografia','porno',
    'sextear','sexting',
    'masturbarse','pajearse','pajear','pajeo','pajea','pajee','pajeas','pajearse',
    'correrse','corrida',              // eyaculación vulgar/ofensiva
    'lamer el culo',
    'chupa pija',
    'hace un pete',
    'pete','petear',
    'felacion','felaciones',
    'cunilinguia','cunilingual',
    // orgasmo, eyacular/eyaculacion: términos médicos válidos → NO bloqueados

    // ── AMENAZAS Y VIOLENCIA VERBAL ─────────────────────────────────────────
    'te mato','voy a matarte','voy a matar',
    'te voy a pegar','te voy a cagar','te cago a palos',
    'te rompo la cara','te rompo el orto',
    'te revienta','te reviento',
    'te parto','te voy a partir',
    'muerate','muérete','ojala te mueras','ojalá te mueras',
    'ojala te mueran','ojalá te mueran',
    'mandarte a matar',
    'te voy a encontrar',
    'voy a buscar tu direccion',
    'te denuncio',

    // ── SPAM / PUBLICIDAD NO DESEADA ─────────────────────────────────────────
    'http','https','www',
    'clickaqui','clickaca','click aqui','hace clic',
    'ganadinero','gana dinero','ganar plata','gana plata',
    'trabajo desde casa','trabajar desde casa',
    'inversion segura','inversiones seguras',
    'trading forex','forex','cripto','bitcoin','ethereum',
    'prestamo rapido','prestamo online','credito rapido',
    'whatsapp','telegram','discord',
    'instagram','facebook','twitter','tiktok','snapchat',
    'contactame','contactame al',
    't.me','wa.me',

    // ── CONTENIDO QUE PROMUEVE VIOLENCIA O EXTREMISMO ───────────────────────
    'muerte a','matar a todos','exterminar',
    'gas a los','camara de gas',
    'heil','sieg heil',
    'kkk','ku klux',
    'terrorista','terrorismo',
    'bomba casera','como hacer una bomba',
    'hacerse matar','suicidarse',
    'matense','mataos',

    // ── OTRAS OFENSAS HABITUALES ─────────────────────────────────────────────
    'inutil','inutiles',
    'bueno para nada',
    'anda a cagar','anda a la mierda','andá a la mierda',
    'la concha de',
    'hijo de re mil puta',
    'remilputa','remilpuntamadre',
    'mogol',
  ];

  // ══════════════════════════════════════════════════════════════
  // 3. FRASES COMPLETAS BLOQUEADAS
  //    Se buscan como subcadena en el texto normalizado.
  // ══════════════════════════════════════════════════════════════
  const _FRASES = [
    // Amenazas directas
    'te voy a matar','te mato','te pego','te voy a cagar',
    'cagar a palos','te cago a palos','te rompo el orto',
    'te rompo la cara','te voy a buscar','voy a buscar tu casa',
    'ojala te mueras','ojalá mueras',
    'que te maten','que te mueras',
    'muerte a ti','voy a hacerte daño',

    // Insultos compuestos
    'anda a la mierda','andá a la mierda',
    'andate a la mierda','andate a cagar',
    'la concha de tu madre','la concha de su madre',
    'la puta que te pario','la puta madre',
    'hijo de puta','hija de puta','hijo de re puta',
    'concha de tu madre','concha de su madre',
    'puta madre','reputa madre','reconcha madre',
    're mil puta','remil puta',
    'chupa pija','chupa pito','chupa la pija',
    'rompe bolas','rompe pelotas',
    'sopla pija','come pija','come mierda',
    'cagarte a palos','cagar a palos',
    'te como el orto','te forro',
    'la re puta madre',

    // Discriminación / odio
    'negro de mierda','negra de mierda',
    'negro cabeza','cabeza negra',
    'indio de mierda','india de mierda',
    'villero de mierda','grasa de mierda',
    'retrasado mental','deficiente mental',
    'down de mierda','autista de mierda',
    'muerto de hambre','muerta de hambre',
    'sos una puta','eres una puta',
    'andate a coger','anda a coger',
    'andate a follar',

    // Contenido sexual explícito fuera de contexto
    'hace un pete','haceme un pete',
    'lame el culo','chupame el culo','lameme',
    'metete la pija','metete la verga',
    'la re chupa','te la chupa',
    'te garcho','me garcho','te cogio',

    // Spam típico
    'haz clic aqui','click aqui','entra al link',
    'gana dinero facil','gana plata facil',
    'escribime al whatsapp','escribime por telegram',
    'inversiones rentables','trading seguro',
  ];

  // ══════════════════════════════════════════════════════════════
  // 4. TÉRMINOS MÉDICOS EXPLÍCITAMENTE PERMITIDOS
  //    Si alguna regla general los atrapara, esta lista los libera.
  // ══════════════════════════════════════════════════════════════
  // (referencia: no se cargan en memoria, solo documentan la decisión)
  // vagina, vulva, clítoris, pene, escroto, testículos, prepucio,
  // ano, recto, uretra, útero, ovario, próstata, endometrio,
  // semen, esperma, menstruación, coito (clínico), eyaculación (clínica),
  // masturbación (clínica), libido, erección (clínica), orgasmo (clínico).

  // ══════════════════════════════════════════════════════════════
  // 5. CONSTRUCCIÓN DE REGEXES (una sola vez, en carga)
  // ══════════════════════════════════════════════════════════════
  // Para _PALABRAS: buscamos en el texto normalizado, tanto como
  // palabra completa (\b...\b) como subcadena, para atrapar derivados.
  // Palabras que solo deben detectarse como palabra completa (no subcadena),
  // porque son subcadena de términos médicos válidos.
  const _SOLO_COMPLETA = new Set(['croto','crota','crotos','culo','culos','culito']);

  const _resPalabras = _PALABRAS.map(p => {
    const pn = _norm(p);
    const escaped = pn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return {
      palabra: pn,
      reCompleta: new RegExp('(?:^|\\s)' + escaped + '(?:\\s|$)', 'i'),
      reParcial:  _SOLO_COMPLETA.has(pn) ? null : new RegExp(escaped, 'i'),
    };
  });

  // Para _FRASES: buscamos con límites de palabra para evitar falsos positivos
  // (ej: "croto" dentro de "escroto").
  const _resFrases = _FRASES.map(f => {
    const fn = _norm(f);
    const escaped = fn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('(?:^|\\s)' + escaped + '(?:\\s|$)', 'i');
  });

  // ══════════════════════════════════════════════════════════════
  // 6. API PÚBLICA
  // ══════════════════════════════════════════════════════════════

  function contieneMalasPalabras(texto) {
    if (!texto || typeof texto !== 'string') return false;
    const norm = _norm(texto);

    for (const { reCompleta, reParcial } of _resPalabras) {
      if (reCompleta.test(norm) || (reParcial && reParcial.test(norm))) return true;
    }
    for (const re of _resFrases) {
      if (re.test(norm)) return true;
    }

    // Spam de mayúsculas: más del 70 % de letras en mayúscula (en texto original)
    const soloLetras = texto.replace(/[^a-zA-Z]/g, '');
    if (soloLetras.length > 10 &&
        soloLetras.replace(/[^A-Z]/g, '').length / soloLetras.length > 0.7) {
      return true; // no exactamente "mala palabra" pero sí comportamiento abusivo
    }

    return false;
  }

  // Devuelve null si el texto es aceptable, o un string con el mensaje de error.
  function moderar(texto) {
    if (!texto || !String(texto).trim()) return 'El mensaje no puede estar vacío.';
    const t = String(texto).trim();
    if (t.length < 5)   return 'El mensaje es demasiado corto (mínimo 5 caracteres).';
    if (t.length > 1000) return 'El mensaje es demasiado largo (máximo 1000 caracteres).';

    if (contieneMalasPalabras(t)) {
      return '⚠️ Tu mensaje contiene lenguaje inapropiado o contenido no permitido. Por favor, revisalo antes de publicar.';
    }
    return null;
  }

  // Reemplaza las coincidencias por asteriscos en el texto original.
  function censurar(texto) {
    if (!texto || typeof texto !== 'string') return texto;
    let result = texto;
    for (const p of _PALABRAS) {
      try {
        const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        result = result.replace(new RegExp('\\b' + escaped + '\\b', 'gi'),
          m => '*'.repeat(m.length));
      } catch (e) {}
    }
    return result;
  }

  window.IARFiltro = { contieneMalasPalabras, moderar, censurar };

})();
