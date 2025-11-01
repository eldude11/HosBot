function normalizeMX(raw) {
  if (!raw) return '';
  let s = String(raw).trim().replace(/\s+/g, '').replace(/[^\d+]/g, '');
  if (s.startsWith('52') && !s.startsWith('+52')) s = '+' + s;
  if (!s.startsWith('+') && s.length === 10) s = '+52' + s;
  if (s.startsWith('+521')) s = '+52' + s.slice(4);
  return s;
}
module.exports = { normalizeMX };
