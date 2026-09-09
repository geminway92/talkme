(() => {
  const LS_KEY = 'talkme_conn_config';

  // La URL/anon key/VAPID public key de Supabase no son secretos (Supabase
  // los diseña para ir en el navegador; la seguridad la da RLS). Por eso es
  // seguro llevarlos en la propia URL: quien monta el chat rellena el
  // formulario una vez, y comparte el enlace resultante con su familia —
  // nadie tiene que tocar un archivo de configuración ni variables de
  // entorno del lado del cliente.
  function readUrlConfig() {
    const params = new URLSearchParams(location.search);
    const url = params.get('su');
    const anon = params.get('sk');
    if (!url || !anon) return null;
    return {
      SUPABASE_URL: url,
      SUPABASE_ANON_KEY: anon,
      VAPID_PUBLIC_KEY: params.get('vp') || '',
      INVITE_CODE: params.get('inv') || '',
    };
  }

  function readStoredConfig() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function saveConfig(cfg) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(cfg));
    } catch (err) {
      // localStorage no disponible (modo privado estricto, etc.): seguimos
      // igual, solo que habrá que volver a abrir el enlace con los datos.
    }
  }

  function buildShareLink(cfg) {
    const params = new URLSearchParams({ su: cfg.SUPABASE_URL, sk: cfg.SUPABASE_ANON_KEY });
    if (cfg.VAPID_PUBLIC_KEY) params.set('vp', cfg.VAPID_PUBLIC_KEY);
    if (cfg.INVITE_CODE) params.set('inv', cfg.INVITE_CODE);
    return `${location.origin}${location.pathname}?${params.toString()}`;
  }

  const FORCE_SETUP_KEY = 'talkme_force_setup';

  // Vuelve a la pantalla de configuración precargada con lo que hubiera
  // guardado (para poder corregir un dato mal escrito sin retiparlo todo).
  // No borra la configuración hasta que se guarde el formulario de nuevo.
  function editConfigAndReload(e) {
    e.preventDefault();
    try {
      sessionStorage.setItem(FORCE_SETUP_KEY, '1');
    } catch (err) {
      // sin sessionStorage, igualmente recargamos: solo perderá el
      // precargado, la config guardada sigue intacta
    }
    location.reload();
  }

  // Comprueba que la URL/anon key responden como un proyecto Supabase real
  // y que la tabla "profiles" existe (o sea, que se ejecutó la migración).
  // Se consulta la tabla directamente (no el endpoint raíz /rest/v1/, que
  // en los proyectos con el formato de keys nuevo exige la secret key y
  // rechaza la publishable/anon key con 401 aunque sea correcta).
  async function testConnection(url, anonKey) {
    const base = url.replace(/\/+$/, '');
    const res = await fetch(`${base}/rest/v1/profiles?select=id&limit=1`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });

    let body = null;
    try {
      body = await res.json();
    } catch (err) {
      // respuesta sin cuerpo JSON, seguimos solo con el status
    }

    if (res.status === 404 || body?.code === 'PGRST205') {
      return { migrationOk: false };
    }
    if (!res.ok) {
      const detail = body?.message || body?.error_description || body?.error || '';
      throw new Error(`El servidor respondió ${res.status}${detail ? ': ' + detail : ''}`);
    }
    return { migrationOk: true };
  }

  const setupScreen = document.getElementById('setup-screen');
  const setupForm = document.getElementById('setup-form');
  const setupUrlInput = document.getElementById('setup-url');
  const setupAnonInput = document.getElementById('setup-anon');
  const setupVapidInput = document.getElementById('setup-vapid');
  const setupInviteInput = document.getElementById('setup-invite');
  const setupTestBtn = document.getElementById('setup-test-btn');
  const setupTestResult = document.getElementById('setup-test-result');
  const setupError = document.getElementById('setup-error');
  const setupResult = document.getElementById('setup-result');
  const setupShareLink = document.getElementById('setup-share-link');
  const setupCopyBtn = document.getElementById('setup-copy-btn');
  const setupContinueBtn = document.getElementById('setup-continue-btn');

  function showSetupScreen(prefill) {
    if (prefill) {
      setupUrlInput.value = prefill.SUPABASE_URL || '';
      setupAnonInput.value = prefill.SUPABASE_ANON_KEY || '';
      setupVapidInput.value = prefill.VAPID_PUBLIC_KEY || '';
      setupInviteInput.value = prefill.INVITE_CODE || '';
    }
    setupScreen.classList.remove('hidden');
  }

  setupTestBtn.addEventListener('click', async () => {
    setupTestResult.className = '';
    setupTestResult.textContent = 'Probando...';
    const url = setupUrlInput.value.trim().replace(/\/+$/, '');
    const anon = setupAnonInput.value.trim();
    if (!url || !anon) {
      setupTestResult.className = 'fail';
      setupTestResult.textContent = 'Rellena al menos la URL y la anon key primero';
      return;
    }
    try {
      const { migrationOk } = await testConnection(url, anon);
      if (migrationOk) {
        setupTestResult.className = 'ok';
        setupTestResult.textContent = '✅ Conecta bien y encuentra la tabla "profiles"';
      } else {
        setupTestResult.className = 'warn';
        setupTestResult.textContent =
          '⚠️ Conecta, pero no encuentra la tabla "profiles" — ¿ejecutaste supabase/migrations/0001_init.sql?';
      }
    } catch (err) {
      setupTestResult.className = 'fail';
      setupTestResult.textContent = `❌ ${err.message}`;
    }
  });

  setupForm.addEventListener('submit', (e) => {
    e.preventDefault();
    setupError.textContent = '';
    const cfg = {
      SUPABASE_URL: setupUrlInput.value.trim().replace(/\/+$/, ''),
      SUPABASE_ANON_KEY: setupAnonInput.value.trim(),
      VAPID_PUBLIC_KEY: setupVapidInput.value.trim(),
      INVITE_CODE: setupInviteInput.value.trim(),
    };
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
      setupError.textContent = 'La URL y la anon key son obligatorias';
      return;
    }
    saveConfig(cfg);
    setupShareLink.value = buildShareLink(cfg);
    setupForm.classList.add('hidden');
    setupResult.classList.remove('hidden');
  });

  setupCopyBtn.addEventListener('click', async () => {
    setupShareLink.select();
    try {
      await navigator.clipboard.writeText(setupShareLink.value);
      setupCopyBtn.textContent = '¡Copiado!';
      setTimeout(() => (setupCopyBtn.textContent = 'Copiar enlace'), 1500);
    } catch (err) {
      // el usuario puede copiarlo a mano del input seleccionado
    }
  });

  document.getElementById('setup-edit-link').addEventListener('click', (e) => {
    e.preventDefault();
    setupResult.classList.add('hidden');
    setupForm.classList.remove('hidden');
  });

  setupContinueBtn.addEventListener('click', () => {
    setupScreen.classList.add('hidden');
    boot(readStoredConfig());
  });

  function boot(cfg) {
  const supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  const state = {
    user: null, // { id, username }
    contacts: [],
    incomingRequests: [],
    outgoingRequests: [],
    onlineIds: new Set(),
    selectedContact: null,
    messagesChannel: null,
    presenceChannel: null,
  };

  // ---- Elementos ----
  const authScreen = document.getElementById('auth-screen');
  const appScreen = document.getElementById('app-screen');
  const logoutBtn = document.getElementById('logout-btn');
  const notifBtn = document.getElementById('notif-btn');
  const inviteLinkBtn = document.getElementById('invite-link-btn');
  const meLabel = document.getElementById('me');
  const myIdLabel = document.getElementById('my-id-label');
  const copyMyIdBtn = document.getElementById('copy-my-id-btn');
  const editAliasBtn = document.getElementById('edit-alias-btn');

  const lockView = document.getElementById('lock-view');
  const lockId = document.getElementById('lock-id');
  const lockForm = document.getElementById('lock-form');
  const lockPin = document.getElementById('lock-pin');
  const lockError = document.getElementById('lock-error');
  const lockSwitchLink = document.getElementById('lock-switch-link');

  const identityChoice = document.getElementById('identity-choice');
  const showCreateBtn = document.getElementById('show-create-btn');
  const showRecoverBtn = document.getElementById('show-recover-btn');

  const createForm = document.getElementById('create-form');
  const createAlias = document.getElementById('create-alias');
  const createPin = document.getElementById('create-pin');
  const createPin2 = document.getElementById('create-pin2');
  const createInvite = document.getElementById('create-invite');
  const createError = document.getElementById('create-error');
  const createBackLink = document.getElementById('create-back-link');

  const recoverForm = document.getElementById('recover-form');
  const recoverId = document.getElementById('recover-id');
  const recoverPin = document.getElementById('recover-pin');
  const recoverError = document.getElementById('recover-error');
  const recoverBackLink = document.getElementById('recover-back-link');

  document.getElementById('reset-config-link').addEventListener('click', editConfigAndReload);

  if (cfg.INVITE_CODE) createInvite.value = cfg.INVITE_CODE;

  // Sin VAPID_PUBLIC_KEY no hay Edge Function de push configurada todavía
  // (es un paso opcional) — ocultamos el botón en vez de dejarlo roto.
  if (!cfg.VAPID_PUBLIC_KEY) notifBtn.classList.add('hidden');

  inviteLinkBtn.addEventListener('click', async () => {
    const link = buildShareLink(cfg);
    try {
      await navigator.clipboard.writeText(link);
      inviteLinkBtn.textContent = '✅';
      setTimeout(() => (inviteLinkBtn.textContent = '🔗'), 1500);
    } catch (err) {
      window.prompt('Copia este enlace de invitación:', link);
    }
  });

  const addContactForm = document.getElementById('add-contact-form');
  const addContactInput = document.getElementById('add-contact-input');
  const contactError = document.getElementById('contact-error');
  const contactList = document.getElementById('contact-list');
  const requestsSection = document.getElementById('requests-section');
  const incomingRequestsList = document.getElementById('incoming-requests');
  const outgoingSection = document.getElementById('outgoing-section');
  const outgoingRequestsList = document.getElementById('outgoing-requests');

  const chatEmpty = document.getElementById('chat-empty');
  const chatActive = document.getElementById('chat-active');
  const chatWith = document.getElementById('chat-with');
  const chatStatus = document.getElementById('chat-status');
  const messagesEl = document.getElementById('messages');
  const messageForm = document.getElementById('message-form');
  const messageInput = document.getElementById('message-input');

  function formatTime(iso) {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // ---- Identidad: sin Supabase Auth ----
  // AVISO: esto no es seguridad real, es una elección consciente para
  // máxima sencillez. El ID es como un "teléfono" (numérico, se genera
  // solo) y el PIN es un candado dentro de la app, no una credencial
  // verificada por el servidor — cualquiera con la anon key podría en
  // teoría leer/escribir la base de datos saltándose esto.
  const MY_ID_KEY = 'talkme_my_id';

  async function hashPin(pin) {
    const bytes = new TextEncoder().encode(pin);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  // 9 dígitos, como un número de teléfono corto.
  function generateCandidateId() {
    return Math.floor(1e8 + Math.random() * 9e8);
  }

  function readSavedId() {
    try {
      return localStorage.getItem(MY_ID_KEY);
    } catch (err) {
      return null;
    }
  }

  function saveId(id) {
    try {
      localStorage.setItem(MY_ID_KEY, String(id));
    } catch (err) {
      // sin localStorage habrá que volver a entrar el ID cada vez
    }
  }

  function forgetId() {
    try {
      localStorage.removeItem(MY_ID_KEY);
    } catch (err) {
      // nada que borrar
    }
  }

  function showLockView(id) {
    lockId.textContent = id;
    lockView.classList.remove('hidden');
    identityChoice.classList.add('hidden');
    createForm.classList.add('hidden');
    recoverForm.classList.add('hidden');
  }

  function showChoiceView() {
    lockView.classList.add('hidden');
    identityChoice.classList.remove('hidden');
    createForm.classList.add('hidden');
    recoverForm.classList.add('hidden');
  }

  showCreateBtn.addEventListener('click', () => {
    identityChoice.classList.add('hidden');
    createForm.classList.remove('hidden');
  });
  createBackLink.addEventListener('click', (e) => {
    e.preventDefault();
    createForm.classList.add('hidden');
    identityChoice.classList.remove('hidden');
  });

  showRecoverBtn.addEventListener('click', () => {
    identityChoice.classList.add('hidden');
    recoverForm.classList.remove('hidden');
  });
  recoverBackLink.addEventListener('click', (e) => {
    e.preventDefault();
    recoverForm.classList.add('hidden');
    identityChoice.classList.remove('hidden');
  });

  lockSwitchLink.addEventListener('click', (e) => {
    e.preventDefault();
    forgetId();
    showChoiceView();
  });

  lockForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    lockError.textContent = '';
    const id = Number(readSavedId());
    const ok = await tryUnlock(id, lockPin.value.trim());
    if (!ok) lockError.textContent = 'PIN incorrecto';
    lockPin.value = '';
  });

  recoverForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    recoverError.textContent = '';
    const id = Number(recoverId.value.trim());
    if (!id) {
      recoverError.textContent = 'Escribe un ID válido';
      return;
    }
    const ok = await tryUnlock(id, recoverPin.value.trim());
    if (!ok) recoverError.textContent = 'ID o PIN incorrectos';
  });

  async function tryUnlock(id, pin) {
    const { data: user, error } = await supabase
      .from('users')
      .select('id, display_name, pin_hash')
      .eq('id', id)
      .maybeSingle();
    if (error || !user) return false;
    const hash = await hashPin(pin);
    if (hash !== user.pin_hash) return false;
    saveId(user.id);
    await enterApp(user);
    return true;
  }

  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    createError.textContent = '';
    const alias = createAlias.value.trim();
    const pin = createPin.value.trim();
    const pin2 = createPin2.value.trim();
    const invite = createInvite.value.trim();

    if (!alias) {
      createError.textContent = 'Escribe un nombre';
      return;
    }
    if (pin.length < 4) {
      createError.textContent = 'El PIN debe tener al menos 4 caracteres';
      return;
    }
    if (pin !== pin2) {
      createError.textContent = 'Los dos PIN no coinciden';
      return;
    }
    if (cfg.INVITE_CODE && invite !== cfg.INVITE_CODE) {
      createError.textContent = 'Código de invitación incorrecto';
      return;
    }

    const pinHash = await hashPin(pin);
    let user = null;
    for (let attempt = 0; attempt < 5 && !user; attempt++) {
      const id = generateCandidateId();
      const { data, error } = await supabase
        .from('users')
        .insert({ id, display_name: alias, pin_hash: pinHash })
        .select('id, display_name')
        .single();
      if (!error) user = data;
      else if (error.code !== '23505') {
        createError.textContent = error.message;
        return;
      }
    }
    if (!user) {
      createError.textContent = 'No se pudo generar un ID libre, prueba otra vez';
      return;
    }
    saveId(user.id);
    await enterApp(user);
  });

  logoutBtn.addEventListener('click', () => {
    showAuthScreen();
  });

  editAliasBtn.addEventListener('click', async () => {
    const newAlias = window.prompt('Nuevo nombre:', state.user?.display_name || '');
    if (!newAlias || !newAlias.trim()) return;
    const { error } = await supabase
      .from('users')
      .update({ display_name: newAlias.trim() })
      .eq('id', state.user.id);
    if (!error) {
      state.user.display_name = newAlias.trim();
      meLabel.textContent = state.user.display_name;
    }
  });

  // ---- Contactos ----
  addContactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    contactError.textContent = '';
    const targetId = Number(addContactInput.value.trim());
    if (!targetId) return;

    const { data, error } = await supabase.rpc('request_contact', {
      me_id: state.user.id,
      target_id: targetId,
    });
    if (error) {
      contactError.textContent = error.message;
      return;
    }
    const messages = {
      not_found: 'No existe ningún usuario con ese ID',
      self: 'No puedes añadirte a ti mismo',
      already_contact: 'Ya está en tu red',
      already_pending: 'Ya le enviaste una solicitud',
    };
    if (messages[data.status]) {
      contactError.textContent = messages[data.status];
      return;
    }
    addContactInput.value = '';
    if (data.status === 'accepted') await loadContacts();
    await loadRequests();
  });

  async function loadContacts() {
    const { data, error } = await supabase
      .from('contacts')
      .select('contact_id, users!contacts_contact_id_fkey(display_name)')
      .eq('owner_id', state.user.id);
    if (error) return;
    state.contacts = data.map((r) => ({ id: r.contact_id, name: r.users.display_name }));
    renderContacts();
  }

  async function loadRequests() {
    const [{ data: incoming }, { data: outgoing }] = await Promise.all([
      supabase
        .from('contact_requests')
        .select('id, from_id, users!contact_requests_from_id_fkey(display_name)')
        .eq('to_id', state.user.id),
      supabase
        .from('contact_requests')
        .select('id, to_id, users!contact_requests_to_id_fkey(display_name)')
        .eq('from_id', state.user.id),
    ]);
    state.incomingRequests = (incoming || []).map((r) => ({
      id: r.id,
      from: { id: r.from_id, name: r.users.display_name },
    }));
    state.outgoingRequests = (outgoing || []).map((r) => ({
      id: r.id,
      to: { id: r.to_id, name: r.users.display_name },
    }));
    renderRequests();
  }

  function renderContacts() {
    contactList.innerHTML = '';
    for (const c of state.contacts) {
      const li = document.createElement('li');
      if (state.selectedContact && state.selectedContact.id === c.id) li.classList.add('active');
      const dot = document.createElement('span');
      dot.className = 'dot' + (state.onlineIds.has(c.id) ? ' online' : '');
      const name = document.createElement('span');
      name.textContent = c.name;
      li.appendChild(dot);
      li.appendChild(name);
      li.addEventListener('click', () => selectContact(c));
      contactList.appendChild(li);
    }
  }

  function renderRequests() {
    incomingRequestsList.innerHTML = '';
    for (const r of state.incomingRequests) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = r.from.name;
      const actions = document.createElement('div');
      actions.className = 'request-actions';

      const acceptBtn = document.createElement('button');
      acceptBtn.className = 'btn-accept';
      acceptBtn.textContent = '✓';
      acceptBtn.addEventListener('click', () => respondToRequest(r.id, 'accept_contact_request'));

      const rejectBtn = document.createElement('button');
      rejectBtn.className = 'btn-reject';
      rejectBtn.textContent = '✕';
      rejectBtn.addEventListener('click', () => respondToRequest(r.id, 'reject_contact_request'));

      actions.appendChild(acceptBtn);
      actions.appendChild(rejectBtn);
      li.appendChild(name);
      li.appendChild(actions);
      incomingRequestsList.appendChild(li);
    }
    requestsSection.classList.toggle('hidden', state.incomingRequests.length === 0);

    outgoingRequestsList.innerHTML = '';
    for (const r of state.outgoingRequests) {
      const li = document.createElement('li');
      li.textContent = `${r.to.name} (pendiente)`;
      outgoingRequestsList.appendChild(li);
    }
    outgoingSection.classList.toggle('hidden', state.outgoingRequests.length === 0);
  }

  async function respondToRequest(requestId, rpcName) {
    const { error } = await supabase.rpc(rpcName, { me_id: state.user.id, request_id: requestId });
    if (error) {
      contactError.textContent = error.message;
      return;
    }
    if (rpcName === 'accept_contact_request') await loadContacts();
    await loadRequests();
  }

  async function selectContact(contact) {
    state.selectedContact = contact;
    renderContacts();
    chatEmpty.classList.add('hidden');
    chatActive.classList.remove('hidden');
    chatWith.textContent = contact.name;
    chatStatus.textContent = state.onlineIds.has(contact.id) ? 'en línea' : 'desconectado';
    messagesEl.innerHTML = '';

    const me = state.user.id;
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .or(`and(from_id.eq.${me},to_id.eq.${contact.id}),and(from_id.eq.${contact.id},to_id.eq.${me})`)
      .order('created_at', { ascending: true });
    if (!error) for (const m of data) renderMessage(m);
    scrollToBottom();
  }

  const renderedMessageIds = new Set();

  function renderMessage(m) {
    if (renderedMessageIds.has(m.id)) return;
    renderedMessageIds.add(m.id);
    const div = document.createElement('div');
    const mine = m.from_id === state.user.id;
    div.className = 'msg ' + (mine ? 'mine' : 'theirs');
    const text = document.createElement('span');
    text.textContent = m.body;
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = formatTime(m.created_at);
    div.appendChild(text);
    div.appendChild(time);
    messagesEl.appendChild(div);
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ---- Mensajes ----
  messageForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !state.selectedContact) return;
    messageInput.value = '';
    const { data, error } = await supabase.rpc('send_message', {
      me_id: state.user.id,
      to_id: state.selectedContact.id,
      body: text,
    });
    if (error) {
      contactError.textContent = error.message;
      return;
    }
    if (state.selectedContact && state.selectedContact.id === data.to_id) {
      renderMessage(data);
      scrollToBottom();
    }
  });

  // ---- Realtime ----
  function subscribeRealtime() {
    if (state.messagesChannel) return; // ya suscrito, evita duplicar canales
    const me = state.user.id;

    state.messagesChannel = supabase
      .channel(`talkme-${me}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `to_id=eq.${me}` },
        ({ new: msg }) => {
          if (state.selectedContact && state.selectedContact.id === msg.from_id) {
            renderMessage(msg);
            scrollToBottom();
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'contact_requests', filter: `to_id=eq.${me}` },
        () => loadRequests()
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'contacts', filter: `owner_id=eq.${me}` },
        () => {
          loadContacts();
          loadRequests();
        }
      )
      .subscribe();

    const presence = supabase.channel('talkme-presence', { config: { presence: { key: me } } });
    state.presenceChannel = presence;
    presence
      .on('presence', { event: 'sync' }, () => {
        state.onlineIds = new Set(Object.keys(presence.presenceState()));
        renderContacts();
        if (state.selectedContact) {
          chatStatus.textContent = state.onlineIds.has(state.selectedContact.id)
            ? 'en línea'
            : 'desconectado';
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await presence.track({ online: true });
      });
  }

  // ---- Notificaciones push ----
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  }

  async function enablePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      contactError.textContent = 'Este navegador no soporta notificaciones push';
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    const reg = await navigator.serviceWorker.register('sw.js');
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(cfg.VAPID_PUBLIC_KEY),
    });
    const json = sub.toJSON();
    await supabase.from('push_subscriptions').upsert(
      {
        user_id: state.user.id,
        endpoint: json.endpoint,
        p256dh: json.keys.p256dh,
        auth: json.keys.auth,
      },
      { onConflict: 'endpoint' }
    );
    notifBtn.classList.add('active');
  }

  notifBtn.addEventListener('click', enablePush);

  copyMyIdBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(String(state.user.id));
      copyMyIdBtn.textContent = '✅';
      setTimeout(() => (copyMyIdBtn.textContent = '📋'), 1500);
    } catch (err) {
      window.prompt('Tu ID:', String(state.user.id));
    }
  });

  // ---- Arranque ----
  async function enterApp(user) {
    state.user = user;

    authScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    meLabel.textContent = user.display_name;
    myIdLabel.textContent = user.id;

    await Promise.all([loadContacts(), loadRequests()]);
    subscribeRealtime();
  }

  function showAuthScreen() {
    if (state.messagesChannel) {
      supabase.removeChannel(state.messagesChannel);
      state.messagesChannel = null;
    }
    if (state.presenceChannel) {
      supabase.removeChannel(state.presenceChannel);
      state.presenceChannel = null;
    }
    state.user = null;
    state.selectedContact = null;
    renderedMessageIds.clear();
    appScreen.classList.add('hidden');
    authScreen.classList.remove('hidden');

    const savedId = readSavedId();
    if (savedId) showLockView(savedId);
    else showChoiceView();
  }

  showAuthScreen();
  } // fin de boot()

  // ---- Resolución de la configuración de conexión ----
  let forcedSetup = false;
  try {
    forcedSetup = sessionStorage.getItem(FORCE_SETUP_KEY) === '1';
    if (forcedSetup) sessionStorage.removeItem(FORCE_SETUP_KEY);
  } catch (err) {
    // sin sessionStorage no hay forma de forzar el formulario tras
    // "Cambiar configuración"; seguimos con el flujo normal
  }

  if (forcedSetup) {
    showSetupScreen(readStoredConfig());
  } else {
    const urlConfig = readUrlConfig();
    if (urlConfig) {
      saveConfig(urlConfig);
      // limpia los parámetros de la URL para que no queden en el historial
      history.replaceState({}, '', location.pathname);
      boot(urlConfig);
    } else {
      const stored = readStoredConfig();
      if (stored) {
        boot(stored);
      } else {
        showSetupScreen();
      }
    }
  }
})();
