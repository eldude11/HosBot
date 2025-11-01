const sessions = new Map();
const setSession = (k, v) => sessions.set(k, v);
const getSession = (k) => sessions.get(k);
const clearSession = (k) => sessions.delete(k);
module.exports = { setSession, getSession, clearSession };
