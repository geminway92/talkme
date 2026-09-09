const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function readDB() {
  if (!fs.existsSync(DB_PATH)) {
    return { users: [], contacts: [], messages: [] };
  }
  const raw = fs.readFileSync(DB_PATH, 'utf8');
  if (!raw.trim()) return { users: [], contacts: [], messages: [] };
  return JSON.parse(raw);
}

function writeDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
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

function addContact(ownerId, contactId) {
  const db = readDB();
  const exists = db.contacts.some(
    (c) => c.ownerId === ownerId && c.contactId === contactId
  );
  if (!exists) {
    db.contacts.push({ ownerId, contactId });
    writeDB(db);
  }
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
  addContact,
  isContact,
  getContacts,
  saveMessage,
  getConversation,
};
