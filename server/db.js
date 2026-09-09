const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'Define la variable de entorno DATABASE_URL con la cadena de conexión de tu base de datos Postgres (por ejemplo, la de Supabase).'
  );
}

// Supabase y la mayoría de Postgres gestionados en la nube requieren TLS.
const useSSL = !/localhost|127\.0\.0\.1/.test(connectionString);
const pool = new Pool({
  connectionString,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS contacts (
      owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      contact_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (owner_id, contact_id)
    );

    CREATE TABLE IF NOT EXISTS contact_requests (
      id SERIAL PRIMARY KEY,
      from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (from_id, to_id)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      from_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      sent_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

async function getSetting(key) {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0]?.value ?? null;
}

async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value]
  );
}

async function findUserByUsername(username) {
  const { rows } = await pool.query(
    'SELECT id, username, password_hash AS "passwordHash" FROM users WHERE lower(username) = lower($1)',
    [username]
  );
  return rows[0] || null;
}

async function findUserById(id) {
  const { rows } = await pool.query(
    'SELECT id, username, password_hash AS "passwordHash" FROM users WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

async function createUser(username, passwordHash) {
  const { rows } = await pool.query(
    'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
    [username, passwordHash]
  );
  return rows[0];
}

// Envía una solicitud de contacto. Si la otra persona ya te había
// solicitado a ti, se aceptan mutuamente al instante.
async function requestContact(fromId, toId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const alreadyContact = await client.query(
      'SELECT 1 FROM contacts WHERE owner_id = $1 AND contact_id = $2',
      [fromId, toId]
    );
    if (alreadyContact.rowCount > 0) {
      await client.query('ROLLBACK');
      return { status: 'already_contact' };
    }

    const reciprocal = await client.query(
      'SELECT id FROM contact_requests WHERE from_id = $1 AND to_id = $2',
      [toId, fromId]
    );
    if (reciprocal.rowCount > 0) {
      await client.query(
        `INSERT INTO contacts (owner_id, contact_id) VALUES ($1, $2), ($2, $1)
         ON CONFLICT DO NOTHING`,
        [fromId, toId]
      );
      await client.query('DELETE FROM contact_requests WHERE id = $1', [reciprocal.rows[0].id]);
      await client.query('COMMIT');
      return { status: 'accepted' };
    }

    const existing = await client.query(
      'SELECT id FROM contact_requests WHERE from_id = $1 AND to_id = $2',
      [fromId, toId]
    );
    if (existing.rowCount > 0) {
      await client.query('ROLLBACK');
      return { status: 'already_pending' };
    }

    const inserted = await client.query(
      'INSERT INTO contact_requests (from_id, to_id) VALUES ($1, $2) RETURNING id',
      [fromId, toId]
    );
    await client.query('COMMIT');
    return { status: 'pending', request: { id: inserted.rows[0].id } };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getIncomingRequests(userId) {
  const { rows } = await pool.query(
    `SELECT cr.id, u.id AS "fromId", u.username AS "fromUsername"
     FROM contact_requests cr
     JOIN users u ON u.id = cr.from_id
     WHERE cr.to_id = $1
     ORDER BY cr.created_at`,
    [userId]
  );
  return rows.map((r) => ({ id: r.id, from: { id: r.fromId, username: r.fromUsername } }));
}

async function getOutgoingRequests(userId) {
  const { rows } = await pool.query(
    `SELECT cr.id, u.id AS "toId", u.username AS "toUsername"
     FROM contact_requests cr
     JOIN users u ON u.id = cr.to_id
     WHERE cr.from_id = $1
     ORDER BY cr.created_at`,
    [userId]
  );
  return rows.map((r) => ({ id: r.id, to: { id: r.toId, username: r.toUsername } }));
}

// Acepta una solicitud recibida; devuelve el usuario que la envió, o null
// si la solicitud no existe o no pertenece a userId.
async function acceptRequest(requestId, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reqRes = await client.query(
      'SELECT from_id AS "fromId", to_id AS "toId" FROM contact_requests WHERE id = $1 AND to_id = $2',
      [requestId, userId]
    );
    if (reqRes.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const request = reqRes.rows[0];

    await client.query(
      `INSERT INTO contacts (owner_id, contact_id) VALUES ($1, $2), ($2, $1)
       ON CONFLICT DO NOTHING`,
      [request.fromId, request.toId]
    );
    await client.query('DELETE FROM contact_requests WHERE id = $1', [requestId]);

    const userRes = await client.query('SELECT id, username FROM users WHERE id = $1', [
      request.fromId,
    ]);
    await client.query('COMMIT');
    return userRes.rows[0] || null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Rechaza o cancela una solicitud en la que userId participa (como
// destinatario o como remitente). Devuelve true si se eliminó algo.
async function removeRequest(requestId, userId) {
  const result = await pool.query(
    'DELETE FROM contact_requests WHERE id = $1 AND (to_id = $2 OR from_id = $2)',
    [requestId, userId]
  );
  return result.rowCount > 0;
}

async function isContact(ownerId, contactId) {
  const { rowCount } = await pool.query(
    'SELECT 1 FROM contacts WHERE owner_id = $1 AND contact_id = $2',
    [ownerId, contactId]
  );
  return rowCount > 0;
}

async function getContacts(ownerId) {
  const { rows } = await pool.query(
    `SELECT u.id, u.username
     FROM contacts c
     JOIN users u ON u.id = c.contact_id
     WHERE c.owner_id = $1
     ORDER BY u.username`,
    [ownerId]
  );
  return rows;
}

async function saveMessage(fromId, toId, text) {
  const sentAt = Date.now();
  const { rows } = await pool.query(
    `INSERT INTO messages (from_id, to_id, text, sent_at) VALUES ($1, $2, $3, $4)
     RETURNING id, from_id AS "fromId", to_id AS "toId", text, sent_at AS "timestamp"`,
    [fromId, toId, text, sentAt]
  );
  return { ...rows[0], timestamp: Number(rows[0].timestamp) };
}

async function getConversation(userA, userB) {
  const { rows } = await pool.query(
    `SELECT id, from_id AS "fromId", to_id AS "toId", text, sent_at AS "timestamp"
     FROM messages
     WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)
     ORDER BY sent_at ASC`,
    [userA, userB]
  );
  return rows.map((r) => ({ ...r, timestamp: Number(r.timestamp) }));
}

module.exports = {
  init,
  getSetting,
  setSetting,
  findUserByUsername,
  findUserById,
  createUser,
  requestContact,
  getIncomingRequests,
  getOutgoingRequests,
  acceptRequest,
  removeRequest,
  isContact,
  getContacts,
  saveMessage,
  getConversation,
};
