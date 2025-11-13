/**
 * utils/natural-language.js
 * Detección de intenciones y extracción de información en lenguaje natural
 */

const { parseDateNaturalOrISO } = require('./dates');

/**
 * Detectar si el mensaje contiene intención de reservar
 */
function detectBookingIntent(text) {
  const lower = text.toLowerCase();
  const keywords = [
    'reservar', 'agendar', 'reserva', 'cita',
    'quirofano', 'quirófano', 'cirugia', 'cirugía',
    'procedimiento', 'operación', 'operacion'
  ];
  return keywords.some(k => lower.includes(k));
}

/**
 * Extraer fecha de un texto
 */
function extractDateFromText(text) {
  return parseDateNaturalOrISO(text, new Date());
}

/**
 * Extraer procedimiento mencionado en el texto
 * Busca por: ID, nombre completo, nombre parcial, o letra (A, B, C)
 */
function extractProcedureFromText(text, procedures) {
  const lower = text.toLowerCase();
  
  // Buscar por ID (número solo)
  const idMatch = text.match(/\b(\d+)\b/);
  if (idMatch) {
    const proc = procedures.find(p => String(p.id) === idMatch[1]);
    if (proc) return proc;
  }
  
  // Buscar por nombre parcial
  for (const proc of procedures) {
    if (lower.includes(proc.name.toLowerCase())) {
      return proc;
    }
  }
  
  // Buscar por letra (A, B, C, etc)
  const letterMatch = text.match(/\b([A-Z])\b/i);
  if (letterMatch) {
    const letterIndex = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
    if (letterIndex >= 0 && letterIndex < procedures.length) {
      return procedures[letterIndex];
    }
  }
  
  return null;
}

/**
 * Extraer quirófano mencionado en el texto
 * Busca por: ID o nombre
 */
function extractORFromText(text, ors) {
  const lower = text.toLowerCase();
  
  // Buscar por ID (número)
  const idMatch = text.match(/\b(\d+)\b/);
  if (idMatch) {
    const or = ors.find(o => String(o.id) === idMatch[1]);
    if (or) return or;
  }
  
  // Buscar por nombre (ej: "qx-2", "quirofano 2")
  for (const or of ors) {
    if (lower.includes(or.name.toLowerCase())) {
      return or;
    }
  }
  
  return null;
}

module.exports = {
  detectBookingIntent,
  extractDateFromText,
  extractProcedureFromText,
  extractORFromText
};