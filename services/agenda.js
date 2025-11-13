/**
 * services/agenda.js
 * Cálculo de slots disponibles para quirófanos
 */

const { dayjs, TIMEZONE } = require('../utils/dates');
const { BUFFER_MIN } = require('../config');
const { getReservations } = require('./sheets');

/**
 * Verificar si dos intervalos se solapan
 */
function within(aStart, aEnd, bStart, bEnd) {
  return (aStart < bEnd) && (bStart < aEnd);
}

/**
 * Obtener slots disponibles para un quirófano en una fecha
 * Disponibilidad 24/7 con margen de buffer entre citas
 */
async function getAvailableSlots(orId, dateISO, durationMin) {
  const startDay = dayjs.tz(`${dateISO} 00:00`, TIMEZONE);
  const endDay = dayjs.tz(`${dateISO} 23:59`, TIMEZONE);
  const busy = await getReservations(orId, dateISO);
  const slots = [];

  const totalBlockMin = durationMin + BUFFER_MIN;

  // Crear bloques ocupados con margen
  const occupiedBlocks = busy.map(b => ({
    start: dayjs(b.start_iso).valueOf(),
    end: dayjs(b.end_iso).add(BUFFER_MIN, 'minute').valueOf()
  }));

  // Generar slots cada (duración + margen) minutos
  for (let t = startDay.clone(); t.valueOf() < endDay.valueOf(); t = t.add(totalBlockMin, 'minute')) {
    const s = t.clone();
    const e = t.clone().add(durationMin, 'minute');
    
    // Verificar que cabe en el día
    if (e.add(BUFFER_MIN, 'minute').valueOf() > endDay.valueOf()) continue;

    // Verificar que no empalma
    const empalma = occupiedBlocks.some(b =>
      within(s.valueOf(), e.valueOf(), b.start, b.end)
    );

    if (!empalma) {
      slots.push({
        label: `${s.format('HH:mm')} — ${e.format('HH:mm')}`,
        startISO: s.toISOString(),
        endISO: e.toISOString()
      });
    }
  }
  
  return slots;
}

module.exports = {
  getAvailableSlots
};