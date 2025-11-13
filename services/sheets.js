/**
 * services/sheets.js
 * Acceso a Google Sheets y Google Apps Script
 * Incluye caché, persistencia local, y todas las operaciones CRUD
 */

const { v4: uuidv4 } = require('uuid');
const Papa = require('papaparse');
const fsp = require('fs').promises;
const { SHEET_URLS, GAS_ENDPOINT, CACHE_TTL, LOCAL_STORAGE_FILE } = require('../config');
const { normalizeMX } = require('../utils/phone');
const { dayjs, TIMEZONE } = require('../utils/dates');

// ===================================
// SISTEMA DE CACHÉ
// ===================================
const cache = new Map();

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

// ===================================
// UTILIDADES CSV
// ===================================

function toCsvUrl(pubhtmlUrl) {
  return pubhtmlUrl.replace('/pubhtml?', '/pub?') + '&output=csv';
}

async function fetchCsv(url, cacheKey = null) {
  // Intentar caché primero
  if (cacheKey) {
    const cached = getCached(cacheKey);
    if (cached) {
      console.log(`✅ Cache hit: ${cacheKey}`);
      return cached;
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    
    if (!res.ok) throw new Error('Fetch error: ' + res.status);
    
    const text = await res.text();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    
    if (cacheKey) {
      setCache(cacheKey, parsed.data);
      console.log(`💾 Cached: ${cacheKey}`);
    }
    
    return parsed.data;
  } catch (error) {
    console.error(`❌ Error fetching CSV (${cacheKey}):`, error.message);
    
    // Fallback a caché expirado
    if (cacheKey && cache.has(cacheKey)) {
      console.log(`⚠️ Using stale cache for ${cacheKey}`);
      return cache.get(cacheKey).data;
    }
    
    throw error;
  }
}

// ===================================
// PERSISTENCIA LOCAL
// ===================================

async function readLocalReservations() {
  try {
    const txt = await fsp.readFile(LOCAL_STORAGE_FILE, 'utf8');
    return JSON.parse(txt);
  } catch {
    return [];
  }
}

async function writeLocalReservations(data) {
  try {
    await fsp.writeFile(LOCAL_STORAGE_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Write local error:', e);
  }
}

async function addLocalReservation(record) {
  try {
    const list = await readLocalReservations();
    list.push(record);
    await writeLocalReservations(list);
  } catch (e) {
    console.error('Local persist error:', e);
  }
}

async function cancelLocalReservation(id) {
  try {
    const list = await readLocalReservations();
    const idx = list.findIndex(r => String(r.id) === String(id));
    if (idx >= 0) {
      list.splice(idx, 1);
      await writeLocalReservations(list);
    }
  } catch (e) {
    console.error('Local cancel error:', e);
  }
}

// ===================================
// OPERACIONES DE DATOS
// ===================================

/**
 * Obtener doctor por número de teléfono
 */
async function getDoctorByPhone(e164) {
  const phone = normalizeMX(e164);
  const rows = await fetchCsv(toCsvUrl(SHEET_URLS.doctores), 'doctores');

  function pickPhone(row) {
    return row.telefono ||
           row['teléfono'] ||
           row['telefono e164'] ||
           row['teléfono e164'] ||
           row.telefono_e164 ||
           row.phone || '';
  }

  const row = rows.find(r => normalizeMX(pickPhone(r)) === phone);
  if (!row) return null;

  return {
    id: Number(row.id),
    name: (row.nombre || row.name || '').trim(),
    phone_e164: normalizeMX(pickPhone(row)),
    specialty: row.especialidad || row.specialty || ''
  };
}

/**
 * Listar todos los procedimientos
 */
async function listProcedures() {
  const rows = await fetchCsv(toCsvUrl(SHEET_URLS.procedimientos), 'procedimientos');
  return rows
    .map(r => ({
      id: Number(r.id),
      name: (r.nombre || '').trim(),
      duration_min: Number(r.duracion_min)
    }))
    .filter(x => x.id && x.name && x.duration_min > 0);
}

/**
 * Listar todos los quirófanos
 */
async function listORs() {
  const rows = await fetchCsv(toCsvUrl(SHEET_URLS.quirofanos), 'quirofanos');
  return rows
    .map(r => ({
      id: Number(r.id),
      name: (r.nombre || '').trim(),
      location: r.piso || ''
    }))
    .filter(x => x.id && x.name);
}

/**
 * Listar reservas de un doctor (con filtros opcionales)
 */
async function listDoctorReservations(doctorId, { fromISO = null, toISO = null } = {}) {
  const rows = await fetchCsv(toCsvUrl(SHEET_URLS.reservas), 'reservas');

  let items = rows
    .map(r => ({
      id: r.id,
      or_id: Number(r.or_id || r.quirofano_id),
      doctor_id: Number(r.doctor_id),
      procedure_id: Number(r.procedure_id || r.procedimiento_id),
      start_iso: r.start_iso,
      end_iso: r.end_iso
    }))
    .filter(r => Number(r.doctor_id) === Number(doctorId));

  if (fromISO) {
    items = items.filter(r => dayjs(r.start_iso).valueOf() >= dayjs(fromISO).valueOf());
  }
  if (toISO) {
    items = items.filter(r => dayjs(r.start_iso).valueOf() <= dayjs(toISO).valueOf());
  }

  items.sort((a, b) => dayjs(a.start_iso).valueOf() - dayjs(b.start_iso).valueOf());
  return items;
}

/**
 * Hidratar reservas con nombres completos
 */
async function hydrateReservations(reservas) {
  const ors = await listORs();
  const procs = await listProcedures();
  const orById = new Map(ors.map(o => [Number(o.id), o.name]));
  const procById = new Map(procs.map(p => [Number(p.id), p.name]));

  return reservas.map(r => ({
    ...r,
    or_name: orById.get(Number(r.or_id)) || ('Qx-' + r.or_id),
    proc_name: procById.get(Number(r.procedure_id)) || ('Proc ' + r.procedure_id)
  }));
}

/**
 * Obtener reservas de un quirófano en una fecha específica
 */
async function getReservations(orId, dateISO) {
  const rows = await fetchCsv(toCsvUrl(SHEET_URLS.reservas));
  const dayStart = dayjs.tz(dateISO + ' 00:00', TIMEZONE).valueOf();
  const dayEnd = dayjs.tz(dateISO + ' 23:59', TIMEZONE).valueOf();

  return rows
    .map(r => ({
      or_id: Number(r.or_id || r.quirofano_id),
      start_iso: r.start_iso,
      end_iso: r.end_iso
    }))
    .filter(r =>
      Number(r.or_id) === Number(orId) &&
      dayjs(r.start_iso).valueOf() >= dayStart &&
      dayjs(r.start_iso).valueOf() <= dayEnd
    );
}

/**
 * Crear una nueva reserva
 */
async function createReservation({ orId, doctorId, procedureId, startISO, endISO }) {
  const id = uuidv4();

  // Re-chequeo anti doble reserva
  const fecha = dayjs(startISO).tz(TIMEZONE).format('YYYY-MM-DD');
  const existing = await getReservations(orId, fecha);
  const overlaps = existing.some(b => {
    const aS = dayjs(startISO).valueOf();
    const aE = dayjs(endISO).valueOf();
    const bS = dayjs(b.start_iso).valueOf();
    const bE = dayjs(b.end_iso).valueOf();
    return aS < bE && bS < aE;
  });

  if (overlaps) {
    return { id: null, conflict: true };
  }

  const record = {
    id,
    or_id: Number(orId),
    doctor_id: Number(doctorId),
    procedure_id: Number(procedureId),
    start_iso: startISO,
    end_iso: endISO
  };

  // Persistencia local
  await addLocalReservation(record);

  // Escritura a Google Apps Script
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    
    const resp = await fetch(GAS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    const txt = await resp.text();
    console.log('GAS status:', resp.status, txt);

    let gas = {};
    try { gas = JSON.parse(txt); } catch (_) {}

    if (!resp.ok || gas.ok === false) {
      if (gas.conflict) return { id: null, conflict: true };
      throw new Error('GAS error: ' + (gas.error || ('HTTP ' + resp.status)));
    }
  } catch (e) {
    console.error('GAS POST failed:', e.message);
  }

  return { id, conflict: false };
}

/**
 * Cancelar una reserva
 */
async function cancelReservation(id) {
  await cancelLocalReservation(id);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    
    const resp = await fetch(GAS_ENDPOINT + '?action=cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    const txt = await resp.text();
    console.log('GAS cancel status:', resp.status, txt);
  } catch (e) {
    console.error('GAS cancel POST failed:', e.message);
  }
}

module.exports = {
  getDoctorByPhone,
  listProcedures,
  listORs,
  listDoctorReservations,
  hydrateReservations,
  getReservations,
  createReservation,
  cancelReservation
};