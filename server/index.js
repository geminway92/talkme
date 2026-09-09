const path = require('path');
const http = require('http');
const express = require('express');
const bcrypt = require('bcryptjs');
const { WebSocketServer } = require('ws');

const db = require('./db');
const { signToken, verifyToken, authMiddleware } = require('./auth');

const PORT = process.env.PORT || 3000;
const INVITE_CODE = process.env.INVITE_CODE || null;

if (!INVITE_CODE) {
  console.warn(
    'AVISO: INVITE_CODE no definido, el registro está abierto a cualquiera. ' +
      'Define la variable de entorno INVITE_CODE para restringir el alta a tu familia/red privada.'
  );
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- Auth ----

app.post('/api/register', (req, res) => {
  const { username, password, inviteCode } = req.body || {};
  if (!username || !password || username.length < 3 || password.length < 4) {
    return res.status(400).json({
      error: 'Usuario (min 3) y contraseña (min 4) son obligatorios',
    });
  }
  if (INVITE_CODE && inviteCode !== INVITE_CODE) {
    return res.status(403).json({ error: 'Código de invitación incorrecto' });
  }
  if (db.findUserByUsername(username)) {
    return res.status(409).json({ error: 'Ese usuario ya existe' });
  }
  const passwordHash = bcrypt.hashSync(password, 10);
  const user = db.createUser(username, passwordHash);
  const token = signToken(user);
  res.json({ token, user: { id: user.id, username: user.username } });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.findUserByUsername(username || '');
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  const token = signToken(user);
  res.json({ token, user: { id: user.id, username: user.username } });
});

// ---- Red de contactos ----

app.get('/api/contacts', authMiddleware, (req, res) => {
  const contacts = db.getContacts(req.user.id).map((c) => ({
    ...c,
    online: onlineUsers.has(c.id),
  }));
  res.json({ contacts });
});

app.post('/api/contacts', authMiddleware, (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ error: 'Falta el usuario' });
  const target = db.findUserByUsername(username);
  if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (target.id === req.user.id) {
    return res.status(400).json({ error: 'No puedes añadirte a ti mismo' });
  }
  db.addContact(req.user.id, target.id);
  res.json({ contact: { id: target.id, username: target.username } });
});

app.get('/api/messages/:contactId', authMiddleware, (req, res) => {
  const contactId = Number(req.params.contactId);
  if (!db.isContact(req.user.id, contactId)) {
    return res
      .status(403)
      .json({ error: 'Ese usuario no está en tu red' });
  }
  const messages = db.getConversation(req.user.id, contactId);
  res.json({ messages });
});

// ---- Servidor HTTP + WebSocket ----

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// userId -> ws connection
const onlineUsers = new Map();

function broadcastPresence(userId, online) {
  const payload = JSON.stringify({ type: 'presence', userId, online });
  for (const ws of onlineUsers.values()) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  let user;
  try {
    user = verifyToken(token);
  } catch (err) {
    ws.close(4001, 'Token inválido');
    return;
  }

  onlineUsers.set(user.id, ws);
  broadcastPresence(user.id, true);

  ws.on('message', (raw) => {
    let data;
    try {
      data = JSON.parse(raw);
    } catch (err) {
      return;
    }

    if (data.type === 'message') {
      const toId = Number(data.to);
      const text = String(data.text || '').trim();
      if (!text || !db.isContact(user.id, toId)) return;

      const message = db.saveMessage(user.id, toId, text);
      ws.send(JSON.stringify({ type: 'message', ...message }));

      const recipientWs = onlineUsers.get(toId);
      if (recipientWs && recipientWs.readyState === recipientWs.OPEN) {
        recipientWs.send(JSON.stringify({ type: 'message', ...message }));
      }
    }
  });

  ws.on('close', () => {
    onlineUsers.delete(user.id);
    broadcastPresence(user.id, false);
  });
});

server.listen(PORT, () => {
  console.log(`TalkMe escuchando en http://localhost:${PORT}`);
});
