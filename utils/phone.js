/**
 * utils/phone.js
 * Utilidades para normalización de teléfonos mexicanos
 */

/**
 * Normaliza un número telefónico mexicano al formato E.164
 * @param {string} raw - Número en cualquier formato
 * @returns {string} Número normalizado (+52XXXXXXXXXX)
 */
function normalizeMX(raw) {
  if (!raw) return '';
  
  // Limpiar: solo dígitos y +
  let s = String(raw).trim().replace(/\s+/g, '').replace(/[^\d+]/g, '');
  
  // Agregar + si empieza con 52
  if (s.startsWith('52') && !s.startsWith('+52')) {
    s = '+' + s;
  }
  
  // Agregar +52 si solo tiene 10 dígitos
  if (!s.startsWith('+') && s.length === 10) {
    s = '+52' + s;
  }
  
  // Corregir +521 (error común)
  if (s.startsWith('+521')) {
    s = '+52' + s.slice(4);
  }
  
  return s;
}

module.exports = { normalizeMX };