const { dayjs, TIMEZONE } = require('../config');
const { getReservations } = require('../data/storage');

function within(aStart, aEnd, bStart, bEnd) {
  return (aStart < bEnd) && (bStart < aEnd);
}

// Respeta duración + buffer (10 min) — igual que tu script funcional
async function getAvailableSlots(orId, dateISO, durationMin) {
  const startDay = dayjs.tz(`${dateISO} 00:00`, TIMEZONE);
  const endDay   = dayjs.tz(`${dateISO} 23:59`, TIMEZONE);
  const busy     = await getReservations(orId, dateISO);
  const slots    = [];

  const bufferMin = 10;
  const totalBlockMin = durationMin + bufferMin;

  const occupiedBlocks = busy.map(b => ({
    start: dayjs(b.start_iso).valueOf(),
    end: dayjs(b.end_iso).add(bufferMin, 'minute').valueOf()
  }));

  for (let t = startDay.clone(); t.valueOf() < endDay.valueOf(); t = t.add(totalBlockMin, 'minute')) {
    const s = t.clone();
    const e = t.clone().add(durationMin, 'minute');
    if (e.add(bufferMin, 'minute').valueOf() > endDay.valueOf()) continue;

    const empalma = occupiedBlocks.some(b => within(s.valueOf(), e.valueOf(), b.start, b.end));
    if (!empalma) {
      slots.push({
        label: `${s.format('HH:mm')} – ${e.format('HH:mm')}`,
        startISO: s.toISOString(),
        endISO: e.toISOString()
      });
    }
  }
  return slots;
}

module.exports = { getAvailableSlots };
