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
  async function testConnection(url, anonKey) {
    const base = url.replace(/\/+$/, '');
    // Las keys nuevas de Supabase (sb_publishable_...) no son un JWT, así
    // que probamos primero solo con "apikey" y, si falla, con las dos
    // cabeceras (formato JWT antiguo) — sin asumir cuál usa tu proyecto.
    let res = await fetch(`${base}/rest/v1/`, { headers: { apikey: anonKey } });
    if (!res.ok) {
      res = await fetch(`${base}/rest/v1/`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
      });
    }
    if (!res.ok) {
      throw new Error(`El servidor respondió ${res.status} — revisa la URL y la anon key`);
    }
    let spec;
    try {
      spec = await res.json();
    } catch (err) {
      throw new Error('Respuesta inesperada: ¿es realmente la URL de un proyecto Supabase?');
    }
    const migrationOk = !!(spec.definitions && spec.definitions.profiles);
    return { migrationOk };
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
  const authForm = document.getElementById('auth-form');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const inviteCodeInput = document.getElementById('invite-code');
  const authError = document.getElementById('auth-error');
  const registerBtn = document.getElementById('register-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const notifBtn = document.getElementById('notif-btn');
  const inviteLinkBtn = document.getElementById('invite-link-btn');
  const meLabel = document.getElementById('me');

  document.getElementById('reset-config-link').addEventListener('click', editConfigAndReload);

  if (cfg.INVITE_CODE) inviteCodeInput.value = cfg.INVITE_CODE;

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

  // Supabase Auth necesita un email por dentro, pero aquí solo se pide
  // usuario: se genera un email interno determinista a partir del nombre
  // de usuario. Nadie lo ve ni lo escribe, y no hace falta que sea real
  // porque "Confirm email" está desactivado.
  function usernameToEmail(username) {
    const slug = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    return `${slug}@talkme.internal`;
  }

  // ---- Auth ----
  authForm.addEventListener('submit', (e) => {
    e.preventDefault();
    login();
  });
  registerBtn.addEventListener('click', register);

  async function login() {
    authError.textContent = '';
    const { error } = await supabase.auth.signInWithPassword({
      email: usernameToEmail(usernameInput.value),
      password: passwordInput.value,
    });
    if (error) authError.textContent = error.message;
  }

  // Registro directo contra Supabase (sin Edge Function): el código de
  // invitación se comprueba aquí, en el navegador. No es una barrera
  // infranqueable para alguien muy técnico, pero el filtro real es que
  // solo tu familia tiene el enlace con la URL/anon key de tu proyecto —
  // ver README para la variante con Edge Function si quieres reforzarlo.
  async function register() {
    authError.textContent = '';
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    const invite = inviteCodeInput.value.trim();

    if (!username || username.length < 3) {
      authError.textContent = 'El usuario debe tener al menos 3 caracteres';
      return;
    }
    if (cfg.INVITE_CODE && invite !== cfg.INVITE_CODE) {
      authError.textContent = 'Código de invitación incorrecto';
      return;
    }

    const { data, error } = await supabase.auth.signUp({
      email: usernameToEmail(username),
      password,
    });
    if (error) {
      authError.textContent = error.message.includes('already registered')
        ? 'Ese usuario ya existe, elige otro'
        : error.message;
      return;
    }
    if (!data.session) {
      authError.textContent =
        'Cuenta creada, pero falta confirmar el email. Desactiva "Confirm email" en Supabase (Authentication → Providers → Email) para entrar directo.';
      return;
    }

    const { error: profileError } = await supabase
      .from('profiles')
      .insert({ id: data.user.id, username });
    if (profileError) {
      authError.textContent = profileError.message.includes('duplicate')
        ? 'Ese usuario ya existe, elige otro'
        : profileError.message;
      return;
    }
    // onAuthStateChange detecta la sesión ya activa y entra solo a la app
  }

  logoutBtn.addEventListener('click', async () => {
    await supabase.auth.signOut();
  });

  // ---- Contactos ----
  addContactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    contactError.textContent = '';
    const username = addContactInput.value.trim();
    if (!username) return;

    const { data, error } = await supabase.rpc('request_contact', { target_username: username });
    if (error) {
      contactError.textContent = error.message;
      return;
    }
    const messages = {
      not_found: 'Usuario no encontrado',
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
      .select('contact_id, profiles!contacts_contact_id_fkey(username)')
      .eq('owner_id', state.user.id);
    if (error) return;
    state.contacts = data.map((r) => ({ id: r.contact_id, username: r.profiles.username }));
    renderContacts();
  }

  async function loadRequests() {
    const [{ data: incoming }, { data: outgoing }] = await Promise.all([
      supabase
        .from('contact_requests')
        .select('id, from_id, profiles!contact_requests_from_id_fkey(username)')
        .eq('to_id', state.user.id),
      supabase
        .from('contact_requests')
        .select('id, to_id, profiles!contact_requests_to_id_fkey(username)')
        .eq('from_id', state.user.id),
    ]);
    state.incomingRequests = (incoming || []).map((r) => ({
      id: r.id,
      from: { id: r.from_id, username: r.profiles.username },
    }));
    state.outgoingRequests = (outgoing || []).map((r) => ({
      id: r.id,
      to: { id: r.to_id, username: r.profiles.username },
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
      name.textContent = c.username;
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
      name.textContent = r.from.username;
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
      li.textContent = `${r.to.username} (pendiente)`;
      outgoingRequestsList.appendChild(li);
    }
    outgoingSection.classList.toggle('hidden', state.outgoingRequests.length === 0);
  }

  async function respondToRequest(requestId, rpcName) {
    const { error } = await supabase.rpc(rpcName, { request_id: requestId });
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
    chatWith.textContent = contact.username;
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

  // ---- Arranque ----
  async function enterApp(user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .single();
    state.user = { id: user.id, username: profile.username };

    authScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    meLabel.textContent = state.user.username;

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
  }

  // onAuthStateChange dispara también con la sesión inicial al suscribirse
  // (evento INITIAL_SESSION), así que no hace falta comprobar getSession() aparte.
  supabase.auth.onAuthStateChange((event, session) => {
    if (session?.user) enterApp(session.user);
    else showAuthScreen();
  });
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
