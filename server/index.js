const path = require('path');
const http = require('http');
const express = require('express');
const bcrypt = require('bcryptjs');
const { WebSocketServer } = require('ws');

const db = require('./db');
const auth = require('./auth');

const PORT = process.env.PORT || 3000;
const INVITE_CODE = process.env.INVITE_CODE || null;

if (!INVITE_CODE) {
  console.warn(
    'AVISO: INVITE_CODE no definido, el registro está abierto a cualquiera. ' +
      'Define la variable de entorno INVITE_CODE para restringir el alta a tu familia/red privada.'
  );
}

// Envuelve un handler async para que sus errores lleguen al middleware de errores.
function ah(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

async function main() {
  await db.init();
  await auth.init();

  const { signToken, verifyToken, authMiddleware } = auth;

  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  // userId -> ws connection
  const onlineUsers = new Map();

  function notifyUser(userId, payload) {
    const ws = onlineUsers.get(userId);
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
  }

  function broadcastPresence(userId, online) {
    const payload = JSON.stringify({ type: 'presence', userId, online });
    for (const ws of onlineUsers.values()) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }

  // ---- Auth ----

  app.post(
    '/api/register',
    ah(async (req, res) => {
      const { username, password, inviteCode } = req.body || {};
      if (!username || !password || username.length < 3 || password.length < 4) {
        return res.status(400).json({
          error: 'Usuario (min 3) y contraseña (min 4) son obligatorios',
        });
      }
      if (INVITE_CODE && inviteCode !== INVITE_CODE) {
        return res.status(403).json({ error: 'Código de invitación incorrecto' });
      }
      if (await db.findUserByUsername(username)) {
        return res.status(409).json({ error: 'Ese usuario ya existe' });
      }
      const passwordHash = bcrypt.hashSync(password, 10);
      const user = await db.createUser(username, passwordHash);
      const token = signToken(user);
      res.json({ token, user: { id: user.id, username: user.username } });
    })
  );

  app.post(
    '/api/login',
    ah(async (req, res) => {
      const { username, password } = req.body || {};
      const user = await db.findUserByUsername(username || '');
      if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) {
        return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
      }
      const token = signToken(user);
      res.json({ token, user: { id: user.id, username: user.username } });
    })
  );

  // ---- Red de contactos (con aceptación mutua) ----

  app.get(
    '/api/contacts',
    authMiddleware,
    ah(async (req, res) => {
      const contacts = await db.getContacts(req.user.id);
      res.json({ contacts: contacts.map((c) => ({ ...c, online: onlineUsers.has(c.id) })) });
    })
  );

  app.get(
    '/api/contacts/requests',
    authMiddleware,
    ah(async (req, res) => {
      const [incoming, outgoing] = await Promise.all([
        db.getIncomingRequests(req.user.id),
        db.getOutgoingRequests(req.user.id),
      ]);
      res.json({ incoming, outgoing });
    })
  );

  app.post(
    '/api/contacts/requests',
    authMiddleware,
    ah(async (req, res) => {
      const { username } = req.body || {};
      if (!username) return res.status(400).json({ error: 'Falta el usuario' });
      const target = await db.findUserByUsername(username);
      if (!target) return res.status(404).json({ error: 'Usuario no encontrado' });
      if (target.id === req.user.id) {
        return res.status(400).json({ error: 'No puedes añadirte a ti mismo' });
      }

      const result = await db.requestContact(req.user.id, target.id);

      if (result.status === 'already_contact') {
        return res.status(409).json({ error: 'Ya está en tu red' });
      }
      if (result.status === 'already_pending') {
        return res.status(409).json({ error: 'Ya le enviaste una solicitud' });
      }
      if (result.status === 'accepted') {
        notifyUser(target.id, {
          type: 'contact_accepted',
          by: { id: req.user.id, username: req.user.username },
        });
        return res.json({
          status: 'accepted',
          contact: { id: target.id, username: target.username },
        });
      }

      notifyUser(target.id, {
        type: 'contact_request',
        request: { id: result.request.id, from: { id: req.user.id, username: req.user.username } },
      });
      res.json({ status: 'pending' });
    })
  );

  app.post(
    '/api/contacts/requests/:id/accept',
    authMiddleware,
    ah(async (req, res) => {
      const requestId = Number(req.params.id);
      const fromUser = await db.acceptRequest(requestId, req.user.id);
      if (!fromUser) return res.status(404).json({ error: 'Solicitud no encontrada' });

      notifyUser(fromUser.id, {
        type: 'contact_accepted',
        by: { id: req.user.id, username: req.user.username },
      });
      res.json({ contact: { id: fromUser.id, username: fromUser.username } });
    })
  );

  app.post(
    '/api/contacts/requests/:id/reject',
    authMiddleware,
    ah(async (req, res) => {
      const requestId = Number(req.params.id);
      const removed = await db.removeRequest(requestId, req.user.id);
      if (!removed) return res.status(404).json({ error: 'Solicitud no encontrada' });
      res.json({ ok: true });
    })
  );

  app.get(
    '/api/messages/:contactId',
    authMiddleware,
    ah(async (req, res) => {
      const contactId = Number(req.params.contactId);
      if (!(await db.isContact(req.user.id, contactId))) {
        return res.status(403).json({ error: 'Ese usuario no está en tu red' });
      }
      const messages = await db.getConversation(req.user.id, contactId);
      res.json({ messages });
    })
  );

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  // ---- WebSocket ----

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

    ws.on('message', async (raw) => {
      let data;
      try {
        data = JSON.parse(raw);
      } catch (err) {
        return;
      }

      if (data.type === 'message') {
        try {
          const toId = Number(data.to);
          const text = String(data.text || '').trim();
          if (!text || !(await db.isContact(user.id, toId))) return;

          const message = await db.saveMessage(user.id, toId, text);
          ws.send(JSON.stringify({ type: 'message', ...message }));

          const recipientWs = onlineUsers.get(toId);
          if (recipientWs && recipientWs.readyState === recipientWs.OPEN) {
            recipientWs.send(JSON.stringify({ type: 'message', ...message }));
          }
        } catch (err) {
          console.error('Error procesando mensaje WS:', err);
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
}

main().catch((err) => {
  console.error('No se pudo arrancar TalkMe:', err);
  process.exit(1);
});
