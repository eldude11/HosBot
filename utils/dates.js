/**
 * utils/dates.js
 * Todo lo relacionado con fechas: formateo, parsing, etc.
 */

const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const tz = require('dayjs/plugin/timezone');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const chrono = require('chrono-node');
require('dayjs/locale/es');

// Configurar dayjs
dayjs.extend(utc);
dayjs.extend(tz);
dayjs.extend(customParseFormat);
dayjs.locale('es');

const { TIMEZONE, CURRENT_YEAR } = require('../config');

/**
 * Formatear fecha en español completo (sin año)
 * Ej: "29 de octubre"
 */
function formatFechaES(isoDate) {
  const meses = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
  ];
  const d = dayjs(isoDate).tz(TIMEZONE);
  return `${d.date()} de ${meses[d.month()]}`;
}

/**
 * Formatear fecha corta
 * Ej: "29 oct"
 */
function formatFechaCorta(isoDate) {
  const mesesCortos = [
    'ene', 'feb', 'mar', 'abr', 'may', 'jun',
    'jul', 'ago', 'sep', 'oct', 'nov', 'dic'
  ];
  const d = dayjs(isoDate).tz(TIMEZONE);
  return `${d.date()} ${mesesCortos[d.month()]}`;
}

/**
 * Parsear fecha en lenguaje natural (español) a formato ISO
 * Soporta: "29 de octubre", "29/10", "YYYY-MM-DD", etc.
 */
function parseDateNaturalOrISO(input, baseDate = new Date()) {
  const txt = (input || '').trim().toLowerCase();
  
  // 1) Formato YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(txt)) {
    return txt;
  }
  
  // 2) Formato DD/MM o DD-MM (asumiendo año actual)
  const ddmmMatch = txt.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (ddmmMatch) {
    const day = ddmmMatch[1].padStart(2, '0');
    const month = ddmmMatch[2].padStart(2, '0');
    return `${CURRENT_YEAR}-${month}-${day}`;
  }
  
  // 3) Formato "15 de octubre", "15 octubre", etc
  const mesesMap = {
    'enero': '01', 'febrero': '02', 'marzo': '03', 'abril': '04',
    'mayo': '05', 'junio': '06', 'julio': '07', 'agosto': '08',
    'septiembre': '09', 'octubre': '10', 'noviembre': '11', 'diciembre': '12'
  };
  
  for (const [mes, num] of Object.entries(mesesMap)) {
    const regex = new RegExp(`(\\d{1,2})\\s*(?:de)?\\s*${mes}`, 'i');
    const match = txt.match(regex);
    if (match) {
      const day = match[1].padStart(2, '0');
      return `${CURRENT_YEAR}-${num}-${day}`;
    }
  }
  
  // 4) Intentar con chrono en español
  try {
    const cand = chrono.es.parse(txt, baseDate);
    if (cand && cand[0]) {
      const d = cand[0].date();
      const parsed = dayjs(d);
      return `${CURRENT_YEAR}-${parsed.format('MM-DD')}`;
    }
  } catch (e) {
    console.error('Chrono parse error:', e);
  }
  
  return null;
}

/**
 * Obtener dayjs configurado (para exportar)
 */
function getDayjs() {
  return dayjs;
}

module.exports = {
  formatFechaES,
  formatFechaCorta,
  parseDateNaturalOrISO,
  dayjs: getDayjs(),
  TIMEZONE
};