/**
 * test.js
 * Script simple para validar que todos los módulos funcionan
 * Ejecutar: node test.js
 */

console.log('🧪 Iniciando tests...\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    failed++;
  }
}

// Test 1: Config se carga
test('Config se carga correctamente', () => {
  const config = require('./config');
  if (!config.TIMEZONE) throw new Error('TIMEZONE no definido');
  if (!config.SHEET_URLS) throw new Error('SHEET_URLS no definido');
});

// Test 2: Phone utils
test('Normalización de teléfono', () => {
  const { normalizeMX } = require('./utils/phone');
  const result = normalizeMX('5512345678');
  if (result !== '+525512345678') throw new Error(`Esperado +525512345678, obtenido ${result}`);
});

// Test 3: Date utils
test('Formateo de fecha ES', () => {
  const { formatFechaES } = require('./utils/dates');
  const result = formatFechaES('2025-10-29');
  if (!result.includes('octubre')) throw new Error('No contiene "octubre"');
});

// Test 4: Date parsing
test('Parsing de fecha DD/MM', () => {
  const { parseDateNaturalOrISO } = require('./utils/dates');
  const result = parseDateNaturalOrISO('29/10');
  if (!result || !result.includes('2025-10-29')) throw new Error('Formato incorrecto');
});

// Test 5: Natural language - booking intent
test('Detección de intención de reserva', () => {
  const { detectBookingIntent } = require('./utils/natural-language');
  const positive = detectBookingIntent('Quiero reservar un quirófano');
  const negative = detectBookingIntent('Hola');
  if (!positive) throw new Error('No detectó intención positiva');
  if (negative) throw new Error('Falso positivo en intención');
});

// Test 6: Sessions
test('Sistema de sesiones', () => {
  const { setSession, getSession, clearSession } = require('./services/sessions');
  setSession('test', { value: 123 });
  const retrieved = getSession('test');
  if (!retrieved || retrieved.value !== 123) throw new Error('Sesión no recuperada correctamente');
  clearSession('test');
  const afterClear = getSession('test');
  if (afterClear) throw new Error('Sesión no eliminada');
});

// Test 7: Sheets module se carga
test('Módulo de Sheets se carga', () => {
  const Sheets = require('./services/sheets');
  if (!Sheets.getDoctorByPhone) throw new Error('getDoctorByPhone no existe');
  if (!Sheets.listProcedures) throw new Error('listProcedures no existe');
  if (!Sheets.createReservation) throw new Error('createReservation no existe');
});

// Test 8: Agenda module se carga
test('Módulo de Agenda se carga', () => {
  const { getAvailableSlots } = require('./services/agenda');
  if (!getAvailableSlots) throw new Error('getAvailableSlots no existe');
});

// Test 9: Handler se carga
test('Handler de WhatsApp se carga', () => {
  const { handleWhatsApp } = require('./handlers/whatsapp');
  if (!handleWhatsApp) throw new Error('handleWhatsApp no existe');
});

// Test 10: Routes se configura
test('Routes se puede configurar', () => {
  const { setupRoutes } = require('./routes');
  if (!setupRoutes) throw new Error('setupRoutes no existe');
});

// Resumen
console.log('\n' + '='.repeat(50));
console.log(`✅ Tests pasados: ${passed}`);
console.log(`❌ Tests fallidos: ${failed}`);
console.log('='.repeat(50));

if (failed === 0) {
  console.log('\n🎉 ¡Todos los tests pasaron! El sistema está listo.\n');
  console.log('Ejecuta: npm start');
  process.exit(0);
} else {
  console.log('\n⚠️  Algunos tests fallaron. Revisa los errores arriba.\n');
  process.exit(1);
}