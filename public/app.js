(() => {
  const state = {
    token: localStorage.getItem('talkme_token') || null,
    user: JSON.parse(localStorage.getItem('talkme_user') || 'null'),
    contacts: [],
    incomingRequests: [],
    outgoingRequests: [],
    selectedContact: null,
    ws: null,
  };

  // ---- Elementos ----
  const authScreen = document.getElementById('auth-screen');
  const appScreen = document.getElementById('app-screen');
  const authForm = document.getElementById('auth-form');
  const usernameInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const inviteCodeInput = document.getElementById('invite-code');
  const authError = document.getElementById('auth-error');
  const loginBtn = document.getElementById('login-btn');
  const registerBtn = document.getElementById('register-btn');
  const logoutBtn = document.getElementById('logout-btn');
  const meLabel = document.getElementById('me');

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

  // ---- Helpers ----
  async function api(path, options = {}) {
    const res = await fetch(path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error de red');
    return data;
  }

  function saveSession(token, user) {
    state.token = token;
    state.user = user;
    localStorage.setItem('talkme_token', token);
    localStorage.setItem('talkme_user', JSON.stringify(user));
  }

  function clearSession() {
    state.token = null;
    state.user = null;
    localStorage.removeItem('talkme_token');
    localStorage.removeItem('talkme_user');
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // ---- Auth ----
  authForm.addEventListener('submit', (e) => {
    e.preventDefault();
    doAuth('/api/login');
  });

  registerBtn.addEventListener('click', () => {
    doAuth('/api/register');
  });

  async function doAuth(path) {
    authError.textContent = '';
    try {
      const { token, user } = await api(path, {
        method: 'POST',
        body: JSON.stringify({
          username: usernameInput.value.trim(),
          password: passwordInput.value,
          inviteCode: inviteCodeInput.value.trim(),
        }),
      });
      saveSession(token, user);
      enterApp();
    } catch (err) {
      authError.textContent = err.message;
    }
  }

  logoutBtn.addEventListener('click', () => {
    if (state.ws) state.ws.close();
    clearSession();
    location.reload();
  });

  // ---- Contactos ----
  addContactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    contactError.textContent = '';
    const username = addContactInput.value.trim();
    if (!username) return;
    try {
      const result = await api('/api/contacts/requests', {
        method: 'POST',
        body: JSON.stringify({ username }),
      });
      addContactInput.value = '';
      if (result.status === 'accepted') await loadContacts();
      await loadRequests();
    } catch (err) {
      contactError.textContent = err.message;
    }
  });

  async function loadContacts() {
    const { contacts } = await api('/api/contacts');
    state.contacts = contacts;
    renderContacts();
  }

  async function loadRequests() {
    const { incoming, outgoing } = await api('/api/contacts/requests');
    state.incomingRequests = incoming;
    state.outgoingRequests = outgoing;
    renderRequests();
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
      acceptBtn.title = 'Aceptar';
      acceptBtn.addEventListener('click', () => respondToRequest(r.id, 'accept'));

      const rejectBtn = document.createElement('button');
      rejectBtn.className = 'btn-reject';
      rejectBtn.textContent = '✕';
      rejectBtn.title = 'Rechazar';
      rejectBtn.addEventListener('click', () => respondToRequest(r.id, 'reject'));

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
      const name = document.createElement('span');
      name.textContent = `${r.to.username} (pendiente)`;
      li.appendChild(name);
      outgoingRequestsList.appendChild(li);
    }
    outgoingSection.classList.toggle('hidden', state.outgoingRequests.length === 0);
  }

  async function respondToRequest(requestId, action) {
    try {
      await api(`/api/contacts/requests/${requestId}/${action}`, { method: 'POST' });
      if (action === 'accept') await loadContacts();
      await loadRequests();
    } catch (err) {
      contactError.textContent = err.message;
    }
  }

  function renderContacts() {
    contactList.innerHTML = '';
    for (const c of state.contacts) {
      const li = document.createElement('li');
      li.dataset.id = c.id;
      if (state.selectedContact && state.selectedContact.id === c.id) {
        li.classList.add('active');
      }
      const dot = document.createElement('span');
      dot.className = 'dot' + (c.online ? ' online' : '');
      const name = document.createElement('span');
      name.textContent = c.username;
      li.appendChild(dot);
      li.appendChild(name);
      li.addEventListener('click', () => selectContact(c));
      contactList.appendChild(li);
    }
  }

  async function selectContact(contact) {
    state.selectedContact = contact;
    renderContacts();
    chatEmpty.classList.add('hidden');
    chatActive.classList.remove('hidden');
    chatWith.textContent = contact.username;
    chatStatus.textContent = contact.online ? 'en línea' : 'desconectado';
    messagesEl.innerHTML = '';

    const { messages } = await api(`/api/messages/${contact.id}`);
    for (const m of messages) renderMessage(m);
    scrollToBottom();
  }

  function renderMessage(m) {
    const div = document.createElement('div');
    const mine = m.fromId === state.user.id;
    div.className = 'msg ' + (mine ? 'mine' : 'theirs');
    const text = document.createElement('span');
    text.textContent = m.text;
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = formatTime(m.timestamp);
    div.appendChild(text);
    div.appendChild(time);
    messagesEl.appendChild(div);
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ---- Mensajes ----
  messageForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = messageInput.value.trim();
    if (!text || !state.selectedContact || !state.ws) return;
    state.ws.send(
      JSON.stringify({ type: 'message', to: state.selectedContact.id, text })
    );
    messageInput.value = '';
  });

  // ---- WebSocket ----
  function connectWS() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(
      `${protocol}://${location.host}/ws?token=${encodeURIComponent(state.token)}`
    );

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'message') {
        const otherId = data.fromId === state.user.id ? data.toId : data.fromId;
        if (state.selectedContact && state.selectedContact.id === otherId) {
          renderMessage(data);
          scrollToBottom();
        }
      } else if (data.type === 'presence') {
        const contact = state.contacts.find((c) => c.id === data.userId);
        if (contact) {
          contact.online = data.online;
          renderContacts();
          if (state.selectedContact && state.selectedContact.id === contact.id) {
            chatStatus.textContent = contact.online ? 'en línea' : 'desconectado';
          }
        }
      } else if (data.type === 'contact_request' || data.type === 'contact_accepted') {
        loadRequests();
        if (data.type === 'contact_accepted') loadContacts();
      }
    };

    ws.onclose = () => {
      setTimeout(() => {
        if (state.token) connectWS();
      }, 2000);
    };

    state.ws = ws;
  }

  // ---- Arranque ----
  async function enterApp() {
    authScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    meLabel.textContent = state.user.username;
    await Promise.all([loadContacts(), loadRequests()]);
    connectWS();
  }

  if (state.token && state.user) {
    enterApp().catch(() => {
      clearSession();
      location.reload();
    });
  }
})();
