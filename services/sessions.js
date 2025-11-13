/**
 * services/sessions.js
 * Manejo de estado conversacional en memoria
 */

const sessions = new Map();

function setSession(key, value) {
  sessions.set(key, value);
}

function getSession(key) {
  return sessions.get(key);
}

function clearSession(key) {
  sessions.delete(key);
}

function hasSession(key) {
  return sessions.has(key);
}

function countSessions() {
  return sessions.size;
}

module.exports = {
  setSession,
  getSession,
  clearSession,
  hasSession,
  countSessions
};