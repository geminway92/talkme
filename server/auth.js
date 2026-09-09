const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('./db');

let JWT_SECRET = null;

// Debe llamarse una vez, antes de arrancar el servidor. Si no hay
// JWT_SECRET en el entorno, genera uno y lo guarda en la base de datos
// (tabla settings) para que sobreviva a reinicios y despliegues.
async function init() {
  if (process.env.JWT_SECRET) {
    JWT_SECRET = process.env.JWT_SECRET;
    return;
  }

  let secret = await db.getSetting('jwt_secret');
  if (!secret) {
    secret = crypto.randomBytes(48).toString('hex');
    await db.setSetting('jwt_secret', secret);
    console.warn(
      'AVISO: JWT_SECRET no definido, se generó uno nuevo y se guardó en la base de datos. ' +
        'Define la variable de entorno JWT_SECRET para tener control explícito sobre él.'
    );
  }
  JWT_SECRET = secret;
}

function signToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: '7d',
  });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No autenticado' });
  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido' });
  }
}

module.exports = { init, signToken, verifyToken, authMiddleware };
