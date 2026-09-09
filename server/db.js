const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function emptyDB() {
  return { users: [], contacts: [], contactRequests: [], messages: [] };
}

function readDB() {
  if (!fs.existsSync(DB_PATH)) return emptyDB();
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  if (!raw.trim()) return emptyDB();
  return { ...emptyDB(), ...JSON.parse(raw) };
}

function writeDB(db) {
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2));
  fs.renameSync(tmpPath, DB_PATH);
}

function nextId(items) {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1;
}

function findUserByUsername(username) {
  const db = readDB();
  return db.users.find(
    (u) => u.username.toLowerCase() === username.toLowerCase()
  );
}

function findUserById(id) {
  const db = readDB();
  return db.users.find((u) => u.id === id);
}

function createUser(username, passwordHash) {
  const db = readDB();
  const user = { id: nextId(db.users), username, passwordHash };
  db.users.push(user);
  writeDB(db);
  return user;
}

function addMutualContact(db, ownerId, contactId) {
  const exists = db.contacts.some(
    (c) => c.ownerId === ownerId && c.contactId === contactId
  );
  if (!exists) db.contacts.push({ ownerId, contactId });
  const existsReverse = db.contacts.some(
    (c) => c.ownerId === contactId && c.contactId === ownerId
  );
  if (!existsReverse) db.contacts.push({ ownerId: contactId, contactId: ownerId });
}

// Envía una solicitud de contacto. Si la otra persona ya te había
// solicitado a ti, se aceptan mutuamente al instante.
function requestContact(fromId, toId) {
  const db = readDB();

  const alreadyContacts = db.contacts.some(
    (c) => c.ownerId === fromId && c.contactId === toId
  );
  if (alreadyContacts) return { status: 'already_contact' };

  const reciprocal = db.contactRequests.find(
    (r) => r.fromId === toId && r.toId === fromId
  );
  if (reciprocal) {
    addMutualContact(db, fromId, toId);
    db.contactRequests = db.contactRequests.filter((r) => r.id !== reciprocal.id);
    writeDB(db);
    return { status: 'accepted' };
  }

  const alreadyPending = db.contactRequests.some(
    (r) => r.fromId === fromId && r.toId === toId
  );
  if (alreadyPending) return { status: 'already_pending' };

  const request = { id: nextId(db.contactRequests), fromId, toId };
  db.contactRequests.push(request);
  writeDB(db);
  return { status: 'pending', request };
}

function getIncomingRequests(userId) {
  const db = readDB();
  return db.contactRequests
    .filter((r) => r.toId === userId)
    .map((r) => {
      const from = db.users.find((u) => u.id === r.fromId);
      return from ? { id: r.id, from: { id: from.id, username: from.username } } : null;
    })
    .filter(Boolean);
}

function getOutgoingRequests(userId) {
  const db = readDB();
  return db.contactRequests
    .filter((r) => r.fromId === userId)
    .map((r) => {
      const to = db.users.find((u) => u.id === r.toId);
      return to ? { id: r.id, to: { id: to.id, username: to.username } } : null;
    })
    .filter(Boolean);
}

// Acepta una solicitud recibida; devuelve el usuario que la envió, o null
// si la solicitud no existe o no pertenece a userId.
function acceptRequest(requestId, userId) {
  const db = readDB();
  const request = db.contactRequests.find(
    (r) => r.id === requestId && r.toId === userId
  );
  if (!request) return null;

  addMutualContact(db, request.fromId, request.toId);
  db.contactRequests = db.contactRequests.filter((r) => r.id !== requestId);
  writeDB(db);
  return db.users.find((u) => u.id === request.fromId) || null;
}

// Rechaza o cancela una solicitud en la que userId participa (como
// destinatario o como remitente). Devuelve true si se eliminó algo.
function removeRequest(requestId, userId) {
  const db = readDB();
  const before = db.contactRequests.length;
  db.contactRequests = db.contactRequests.filter(
    (r) => !(r.id === requestId && (r.toId === userId || r.fromId === userId))
  );
  if (db.contactRequests.length === before) return false;
  writeDB(db);
  return true;
}

function isContact(ownerId, contactId) {
  const db = readDB();
  return db.contacts.some(
    (c) => c.ownerId === ownerId && c.contactId === contactId
  );
}

function getContacts(ownerId) {
  const db = readDB();
  return db.contacts
    .filter((c) => c.ownerId === ownerId)
    .map((c) => db.users.find((u) => u.id === c.contactId))
    .filter(Boolean)
    .map((u) => ({ id: u.id, username: u.username }));
}

function saveMessage(fromId, toId, text) {
  const db = readDB();
  const message = {
    id: nextId(db.messages),
    fromId,
    toId,
    text,
    timestamp: Date.now(),
  };
  db.messages.push(message);
  writeDB(db);
  return message;
}

function getConversation(userA, userB) {
  const db = readDB();
  return db.messages
    .filter(
      (m) =>
        (m.fromId === userA && m.toId === userB) ||
        (m.fromId === userB && m.toId === userA)
    )
    .sort((a, b) => a.timestamp - b.timestamp);
}

module.exports = {
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
