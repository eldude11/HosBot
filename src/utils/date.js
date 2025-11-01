const { dayjs, TIMEZONE, CURRENT_YEAR } = require('../config');
const { chrono } = require('./chrono');

function parseDateNaturalOrISO(input, baseDate = new Date()) {
  const txt = (input || '').trim().toLowerCase();

  if (/^\d{4}-\d{2}-\d{2}$/.test(txt)) return txt;

  const ddmm = txt.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if (ddmm) {
    const day = ddmm[1].padStart(2, '0');
    const month = ddmm[2].padStart(2, '0');
    return `${CURRENT_YEAR}-${month}-${day}`;
  }

  const mesesMap = {
    enero: '01', febrero: '02', marzo: '03', abril: '04', mayo: '05', junio: '06',
    julio: '07', agosto: '08', septiembre: '09', octubre: '10', noviembre: '11', diciembre: '12'
  };
  for (const [mes, num] of Object.entries(mesesMap)) {
    const rx = new RegExp(`(\\d{1,2})\\s*(?:de)?\\s*${mes}`, 'i');
    const m = txt.match(rx);
    if (m) {
      const day = m[1].padStart(2, '0');
      return `${CURRENT_YEAR}-${num}-${day}`;
    }
  }

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

function formatFechaES(isoDate) {
  const meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const d = dayjs(isoDate).tz(TIMEZONE);
  return `${d.date()} de ${meses[d.month()]}`;
}

function formatFechaCorta(isoDate) {
  const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const d = dayjs(isoDate).tz(TIMEZONE);
  return `${d.date()} ${meses[d.month()]}`;
}

module.exports = { dayjs, TIMEZONE, parseDateNaturalOrISO, formatFechaES, formatFechaCorta };
