const { dayjs, TIMEZONE, SHEET_URLS, GAS_ENDPOINT } = require('../config');
const { toCsvUrl, fetchCsv } = require('../utils/csv');
const { listORs, listProcedures } = require('./sheets');
const { v4: uuidv4 } = require('uuid');
const fsp = require('fs').promises;

const LOCAL_RES_FILE = './reservas.json';

async function readLocalReservations() {
  try { const txt = await fsp.readFile(LOCAL_RES_FILE, 'utf8'); return JSON.parse(txt); }
  catch { return []; }
}
async function writeLocalReservations(data) {
  try { await fsp.writeFile(LOCAL_RES_FILE, JSON.stringify(data, null, 2), 'utf8'); }
  catch (e) { console.error('Write local error:', e); }
}

async function listDoctorReservations(doctorId, { fromISO = null, toISO = null } = {}) {
  const rows = await fetchCsv(toCsvUrl(SHEET_URLS.reservas));
  let items = rows.map(r => ({
    id: r.id,
    or_id: Number(r.or_id || r.quirofano_id),
    doctor_id: Number(r.doctor_id),
    procedure_id: Number(r.procedure_id || r.procedimiento_id),
    start_iso: r.start_iso,
    end_iso: r.end_iso
  })).filter(r => Number(r.doctor_id) === Number(doctorId));

  if (fromISO) items = items.filter(r => dayjs(r.start_iso).valueOf() >= dayjs(fromISO).valueOf());
  if (toISO)   items = items.filter(r => dayjs(r.start_iso).valueOf() <= dayjs(toISO).valueOf());

  items.sort((a, b) => dayjs(a.start_iso).valueOf() - dayjs(b.start_iso).valueOf());
  return items;
}

async function hydrateReservations(reservas) {
  const ors   = await listORs();
  const procs = await listProcedures();
  const orById   = new Map(ors.map(o => [Number(o.id), o.name]));
  const procById = new Map(procs.map(p => [Number(p.id), p.name]));
  return reservas.map(r => ({
    ...r,
    or_name:   orById.get(Number(r.or_id)) || ('Qx-' + r.or_id),
    proc_name: procById.get(Number(r.procedure_id)) || ('Proc ' + r.procedure_id)
  }));
}

async function getReservations(orId, dateISO) {
  const rows = await fetchCsv(toCsvUrl(SHEET_URLS.reservas));
  const dayStart = dayjs.tz(`${dateISO} 00:00`, TIMEZONE).valueOf();
  const dayEnd   = dayjs.tz(`${dateISO} 23:59`, TIMEZONE).valueOf();
  return rows
    .map(r => ({ or_id: Number(r.or_id || r.quirofano_id), start_iso: r.start_iso, end_iso: r.end_iso }))
    .filter(r =>
      Number(r.or_id) === Number(orId) &&
      dayjs(r.start_iso).valueOf() >= dayStart &&
      dayjs(r.start_iso).valueOf() <= dayEnd
    );
}

async function createReservation({ orId, doctorId, procedureId, startISO, endISO }) {
  const id = uuidv4();

  // Anti-doble reserva
  const fecha = dayjs(startISO).tz(TIMEZONE).format('YYYY-MM-DD');
  const existing = await getReservations(orId, fecha);
  const overlaps = existing.some(b => {
    const aS = dayjs(startISO).valueOf();
    const aE = dayjs(endISO).valueOf();
    const bS = dayjs(b.start_iso).valueOf();
    const bE = dayjs(b.end_iso).valueOf();
    return aS < bE && bS < aE;
  });
  if (overlaps) return { id: null, conflict: true };

  const record = { id, or_id: Number(orId), doctor_id: Number(doctorId), procedure_id: Number(procedureId), start_iso: startISO, end_iso: endISO };

  // Local best-effort
  try {
    const list = await readLocalReservations();
    list.push(record);
    await writeLocalReservations(list);
  } catch (e) {
    console.error('Local persist error:', e);
  }

  // GAS
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
    try { gas = JSON.parse(txt); } catch {}
    if (!resp.ok || gas.ok === false) {
      if (gas.conflict) return { id: null, conflict: true };
      throw new Error('GAS error: ' + (gas.error || ('HTTP ' + resp.status)));
    }
  } catch (e) {
    console.error('GAS POST failed:', e.message);
  }

  return { id, conflict: false };
}

async function cancelReservation(id) {
  // Local
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
  // GAS
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
  listDoctorReservations,
  hydrateReservations,
  getReservations,
  createReservation,
  cancelReservation,
};
