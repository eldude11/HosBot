const { SHEET_URLS } = require('../config');
const { toCsvUrl, fetchCsv } = require('../utils/csv');
const { normalizeMX } = require('../utils/phone');

async function getDoctorByPhone(e164) {
  const phone = normalizeMX(e164);
  const rows = await fetchCsv(toCsvUrl(SHEET_URLS.doctores), { cacheKey: 'doctores' });

  function pickPhone(row) {
    return row.telefono || row['teléfono'] || row['telefono e164'] || row['teléfono e164'] || row.telefono_e164 || row.phone || '';
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

async function listProcedures() {
  const rows = await fetchCsv(toCsvUrl(SHEET_URLS.procedimientos), { cacheKey: 'procedimientos' });
  return rows.map(r => ({
    id: Number(r.id),
    name: (r.nombre || '').trim(),
    duration_min: Number(r.duracion_min)
  })).filter(x => x.id && x.name && x.duration_min > 0);
}

async function listORs() {
  const rows = await fetchCsv(toCsvUrl(SHEET_URLS.quirofanos), { cacheKey: 'quirofanos' });
  return rows.map(r => ({
    id: Number(r.id),
    name: (r.nombre || '').trim(),
    location: r.piso || ''
  })).filter(x => x.id && x.name);
}

module.exports = { getDoctorByPhone, listProcedures, listORs };
