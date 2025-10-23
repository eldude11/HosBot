require('dotenv').config();
const express = require('express');
const { twiml: { MessagingResponse } } = require('twilio');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const tz = require('dayjs/plugin/timezone');
const customParseFormat = require('dayjs/plugin/customParseFormat');
const { v4: uuidv4 } = require('uuid');
const Papa = require('papaparse');
const fsp = require('fs').promises;
const chrono = require('chrono-node');
require('dayjs/locale/es');

dayjs.extend(utc);
dayjs.extend(tz);
dayjs.extend(customParseFormat);
dayjs.locale('es');

// =======================
// Config
// =======================
const TIMEZONE = 'America/Mexico_City';
const CURRENT_YEAR = 2025;
const CACHE_TTL = 30000; // 30 segundos de caché para reducir llamadas a Sheets

// Google Sheets (pubhtml -> CSV)
const SHEET_URLS = {
  doctores:      'https://docs.google.com/spreadsheets/d/e/2PACX-1vQm8oAhj9HW8nWE7QY6BjWwEJkCEPuK5EawbyvlMm_v6SDNNwKM0ycdkc5qz2TFCjNN6Xrxo2l3atBA/pubhtml?gid=502193309&single=true',
  quirofanos:    'https://docs.google.com/spreadsheets/d/e/2PACX-1vQm8oAhj9HW8nWE7QY6BjWwEJkCEPuK5EawbyvlMm_v6SDNNwKM0ycdkc5qz2TFCjNN6Xrxo2l3atBA/pubhtml?gid=1055760109&single=true',
  procedimientos:'https://docs.google.com/spreadsheets/d/e/2PACX-1vQm8oAhj9HW8nWE7QY6BjWwEJkCEPuK5EawbyvlMm_v6SDNNwKM0ycdkc5qz2TFCjNN6Xrxo2l3atBA/pubhtml?gid=1429038100&single=true',
  reservas:      'https://docs.google.com/spreadsheets/d/e/2PACX-1vQm8oAhj9HW8nWE7QY6BjWwEJkCEPuK5EawbyvlMm_v6SDNNwKM0ycdkc5qz2TFCjNN6Xrxo2l3atBA/pubhtml?gid=0&single=true'
};

// Endpoint de Google Apps Script
const GAS_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzlL2_aLHuArPDqzn2TPXjeSMCQoSjmO2jWVSu-VCD9WQIBaurxfsXjv1Up2IFGnVPU/exec';

// =======================
// Sistema de Caché Simple
// =======================
const cache = new Map();

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

// =======================
// Detección de lenguaje natural
// =======================
function detectBookingIntent(text) {
  const lower = text.toLowerCase();
  const keywords = ['reservar', 'agendar', 'reserva', 'cita', 'quirofano', 'quirófano', 'cirugia', 'cirugía', 'procedimiento'];
  return keywords.some(k => lower.includes(k));
}

function extractDateFromText(text) {
  // Intentar extraer fecha del texto
  const parsed = parseDateNaturalOrISO(text, new Date());
  return parsed;
}

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
    const letterIndex = letterMatch[1].toUpperCase().charCodeAt(0) - 65; // A=0, B=1, C=2...
    if (letterIndex >= 0 && letterIndex < procedures.length) {
      return procedures[letterIndex];
    }
  }
  
  return null;
}

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

// =======================
// Utils
// =======================
function toCsvUrl(pubhtmlUrl) {
  return pubhtmlUrl.replace('/pubhtml?', '/pub?') + '&output=csv';
}

function normalizeMX(raw) {
  if (!raw) return '';
  let s = String(raw).trim().replace(/\s+/g, '').replace(/[^\d+]/g, '');
  if (s.startsWith('52') && !s.startsWith('+52')) s = '+' + s;
  if (!s.startsWith('+') && s.length === 10) s = '+52' + s;
  if (s.startsWith('+521')) s = '+52' + s.slice(4);
  return s;
}

async function fetchCsv(url, cacheKey = null) {
  // Intentar caché primero
  if (cacheKey) {
    const cached = getCached(cacheKey);
    if (cached) {
      console.log(`✅ Cache hit: ${cacheKey}`);
      return cached;
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8 seg timeout
    
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    
    if (!res.ok) throw new Error('Fetch error: ' + res.status);
    
    const text = await res.text();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    
    // Guardar en caché
    if (cacheKey) {
      setCache(cacheKey, parsed.data);
      console.log(`💾 Cached: ${cacheKey}`);
    }
    
    return parsed.data;
  } catch (error) {
    console.error(`❌ Error fetching CSV (${cacheKey}):`, error.message);
    
    // Si hay caché expirado, usarlo como fallback
    if (cacheKey && cache.has(cacheKey)) {
      console.log(`⚠️ Using stale cache for ${cacheKey}`);
      return cache.get(cacheKey).data;
    }
    
    throw error;
  }
}

// Natural language date parsing (ES) - SIN especificar año
function parseDateNaturalOrISO(input, baseDate = new Date()) {
  const txt = (input || '').trim().toLowerCase();
  
  // 1) Formato YYYY-MM-DD (por si acaso)
  if (/^\d{4}-\d{2}-\d{2}$/.test(txt)) return txt;
  
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
  
  // 4) Intentar con chrono en español (limita a año actual)
  try {
    const cand = chrono.es.parse(txt, baseDate);
    if (cand && cand[0]) {
      const d = cand[0].date();
      const parsed = dayjs(d);
      // Forzar año actual si chrono devuelve otro año
      return `${CURRENT_YEAR}-${parsed.format('MM-DD')}`;
    }
  } catch (e) {
    console.error('Chrono parse error:', e);
  }
  
  return null;
}

// Formatear fecha en español (sin año)
function formatFechaES(isoDate) {
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 
                 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const d = dayjs(isoDate).tz(TIMEZONE);
  return `${d.date()} de ${meses[d.month()]}`;
}

// Formatear fecha corta (ej: "29 oct")
function formatFechaCorta(isoDate) {
  const mesesCortos = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 
                       'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const d = dayjs(isoDate).tz(TIMEZONE);
  return `${d.date()} ${mesesCortos[d.month()]}`;
}

// =======================
// Persistencia local (best effort)
// =======================
const LOCAL_RES_FILE = './reservas.json';

async function readLocalReservations() {
  try { 
    const txt = await fsp.readFile(LOCAL_RES_FILE, 'utf8'); 
    return JSON.parse(txt); 
  } catch { 
    return []; 
  }
}

async function writeLocalReservations(data) {
  try {
    await fsp.writeFile(LOCAL_RES_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Write local error:', e);
  }
}

// =======================
// Adaptador de datos (Sheets + Apps Script)
// =======================
const Data = (function () {
  return {
    async getDoctorByPhone(e164) {
      const phone = normalizeMX(e164);
      const rows = await fetchCsv(toCsvUrl(SHEET_URLS.doctores), 'doctores');

      function pickPhone(row) {
        return row.telefono ||
               row['teléfono'] ||
               row['telefono e164'] ||
               row['teléfono e164'] ||
               row.telefono_e164 ||
               row.phone || '';
      }

      const row = rows.find(r => normalizeMX(pickPhone(r)) === phone);
      if (!row) return null;

      return {
        id: Number(row.id),
        name: (row.nombre || row.name || '').trim(),
        phone_e164: normalizeMX(pickPhone(row)),
        specialty: row.especialidad || row.specialty || ''
      };
    },

    async listProcedures() {
      const rows = await fetchCsv(toCsvUrl(SHEET_URLS.procedimientos), 'procedimientos');
      return rows.map(r => ({
        id: Number(r.id),
        name: (r.nombre || '').trim(),
        duration_min: Number(r.duracion_min)
      })).filter(x => x.id && x.name && x.duration_min > 0);
    },

    async listORs() {
      const rows = await fetchCsv(toCsvUrl(SHEET_URLS.quirofanos), 'quirofanos');
      return rows.map(r => ({
        id: Number(r.id),
        name: (r.nombre || '').trim(),
        location: r.piso || ''
      })).filter(x => x.id && x.name);
    },

    async listDoctorReservations(doctorId, { fromISO = null, toISO = null } = {}) {
      const rows = await fetchCsv(toCsvUrl(SHEET_URLS.reservas), 'reservas');

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
    },

    async hydrateReservations(reservas) {
      const ors   = await Data.listORs();
      const procs = await Data.listProcedures();
      const orById   = new Map(ors.map(o   => [Number(o.id), o.name]));
      const procById = new Map(procs.map(p => [Number(p.id), p.name]));

      return reservas.map(r => ({
        ...r,
        or_name:   orById.get(Number(r.or_id))   || ('Qx-' + r.or_id),
        proc_name: procById.get(Number(r.procedure_id)) || ('Proc ' + r.procedure_id)
      }));
    },

    async getReservations(orId, dateISO) {
      // No usar caché para reservas (datos cambiantes)
      const rows = await fetchCsv(toCsvUrl(SHEET_URLS.reservas));
      const dayStart = dayjs.tz(dateISO + ' 00:00', TIMEZONE).valueOf();
      const dayEnd   = dayjs.tz(dateISO + ' 23:59', TIMEZONE).valueOf();

      return rows
        .map(r => ({
          or_id: Number(r.or_id || r.quirofano_id),
          start_iso: r.start_iso,
          end_iso: r.end_iso
        }))
        .filter(r =>
          Number(r.or_id) === Number(orId) &&
          dayjs(r.start_iso).valueOf() >= dayStart &&
          dayjs(r.start_iso).valueOf() <= dayEnd
        );
    },

    async createReservation(p) {
      const id = uuidv4();

      // Re-chequeo anti doble reserva
      const fecha = dayjs(p.startISO).tz(TIMEZONE).format('YYYY-MM-DD');
      const existing = await Data.getReservations(p.orId, fecha);
      const overlaps = existing.some(b => {
        const aS = dayjs(p.startISO).valueOf();
        const aE = dayjs(p.endISO).valueOf();
        const bS = dayjs(b.start_iso).valueOf();
        const bE = dayjs(b.end_iso).valueOf();
        return aS < bE && bS < aE;
      });
      if (overlaps) return { id: null, conflict: true };

      const record = {
        id,
        or_id: Number(p.orId),
        doctor_id: Number(p.doctorId),
        procedure_id: Number(p.procedureId),
        start_iso: p.startISO,
        end_iso: p.endISO
      };

      // Persistencia local
      try {
        const list = await readLocalReservations();
        list.push(record);
        await writeLocalReservations(list);
      } catch (e) {
        console.error('Local persist error:', e);
      }

      // Escritura GAS con timeout
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10 seg
        
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
        try { gas = JSON.parse(txt); } catch (_) {}

        if (!resp.ok || gas.ok === false) {
          if (gas.conflict) return { id: null, conflict: true };
          throw new Error('GAS error: ' + (gas.error || ('HTTP ' + resp.status)));
        }
      } catch (e) {
        console.error('GAS POST failed:', e.message);
        // Continuar aunque falle GAS (tenemos persistencia local)
      }

      return { id, conflict: false };
    },

    async cancelReservation(id) {
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

      // GAS con timeout
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
  };
})();

// =======================
// Agenda (slots) - 24/7 disponibilidad con margen de 10 minutos
// =======================
function within(aStart, aEnd, bStart, bEnd) {
  return (aStart < bEnd) && (bStart < aEnd);
}

async function getAvailableSlots(orId, dateISO, durationMin) {
  const startDay = dayjs.tz(`${dateISO} 00:00`, TIMEZONE);
  const endDay   = dayjs.tz(`${dateISO} 23:59`, TIMEZONE);
  const busy     = await Data.getReservations(orId, dateISO);
  const slots    = [];

  // Margen de limpieza/preparación entre citas
  const bufferMin = 10;
  const totalBlockMin = durationMin + bufferMin;

  // Crear bloques ocupados extendidos con el margen
  const occupiedBlocks = busy.map(b => ({
    start: dayjs(b.start_iso).valueOf(),
    end: dayjs(b.end_iso).add(bufferMin, 'minute').valueOf()
  }));

  // Generar slots cada (duración + margen) minutos
  for (let t = startDay.clone(); t.valueOf() < endDay.valueOf(); t = t.add(totalBlockMin, 'minute')) {
    const s = t.clone();
    const e = t.clone().add(durationMin, 'minute');
    
    // Verificar que el slot completo + margen cabe en el día
    if (e.add(bufferMin, 'minute').valueOf() > endDay.valueOf()) continue;

    // Verificar que no empalma con ningún bloque ocupado
    const empalma = occupiedBlocks.some(b =>
      within(s.valueOf(), e.valueOf(), b.start, b.end)
    );

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

// =======================
// Sesiones
// =======================
const sessions = new Map();
function setSession(k, v) { sessions.set(k, v); }
function getSession(k)    { return sessions.get(k); }
function clearSession(k)  { sessions.delete(k); }

// =======================
// App
// =======================
const app = express();
app.use(express.urlencoded({ extended: false }));
app.get('/', (_req, res) => res.send('Bot de Reservas Quirófano - Activo ✅'));

app.post('/whatsapp', async (req, res) => {
  const from = (req.body?.From || '').replace('whatsapp:', '');
  const body = (req.body?.Body || '').trim();
  const msg  = new MessagingResponse();
  console.log('📥 IN:', from, body);

  try {
    // RESET → vuelve al menú
    if (body.toLowerCase() === 'reset') {
      clearSession(from);
      const doc = await Data.getDoctorByPhone(from);
      if (doc) {
        setSession(from, { step: 'MENU_DOC', doctor: doc });
        msg.message(
          `👋 ¡Hola ${doc.name}! Qué gusto saludarle.\n` +
          `Soy su asistente quirúrgico digital.\n\n` +
          `Puedo ayudarle con:\n` +
          `1️⃣ Reservar quirófano\n` +
          `2️⃣ Ver sus próximas reservas\n` +
          `3️⃣ Cancelar una reserva\n\n` +
          `¿Con cuál comenzamos?`
        );
      } else {
        setSession(from, { step: 'MENU_PUB' });
        msg.message('👋 Bienvenido.\n1) Directorio médico\n2) Servicios\n3) Agendar cita');
      }
      console.log('📤 OUT: RESET response');
      return res.type('text/xml').send(msg.toString());
    }

    const doctor = await Data.getDoctorByPhone(from);
    let state = getSession(from);

    // Inicio
    if (!state) {
      if (doctor) {
        setSession(from, { step: 'MENU_DOC', doctor });
        msg.message(
          `👋 ¡Hola ${doctor.name}! Qué gusto saludarle.\n` +
          `Soy su asistente quirúrgico digital.\n\n` +
          `Puedo ayudarle con:\n` +
          `1️⃣ Reservar quirófano\n` +
          `2️⃣ Ver sus próximas reservas\n` +
          `3️⃣ Cancelar una reserva\n\n` +
          `¿Con cuál comenzamos?`
        );
      } else {
        setSession(from, { step: 'MENU_PUB' });
        msg.message('👋 Bienvenido.\n1) Directorio médico\n2) Servicios\n3) Agendar cita');
      }
      console.log('📤 OUT: Initial greeting');
      return res.type('text/xml').send(msg.toString());
    }

    // --- Menú público (demo)
    if (state.step === 'MENU_PUB') {
      if (body === '1') msg.message('📋 Directorio médico (demo)');
      else if (body === '2') msg.message('🏥 Servicios (demo)');
      else if (body === '3') msg.message('📅 Agendar cita (demo)');
      else msg.message('👋 Opciones:\n1) Directorio médico\n2) Servicios\n3) Agendar cita');
      console.log('📤 OUT: Public menu');
      return res.type('text/xml').send(msg.toString());
    }

    // =======================
    // Menú doctor
    // =======================
    if (state.step === 'MENU_DOC') {
      if (body === '1') {
        const procs = await Data.listProcedures();
        setSession(from, { step: 'PROC', doctor: state.doctor });
        msg.message(
          `Perfecto, doctor.\n` +
          `¿Qué procedimiento desea realizar?\n\n` +
          `Aquí tiene la lista disponible 👇\n\n` +
          procs.map((p, i) => `${p.id}) ${p.name} (${p.duration_min} min)`).join('\n') +
          `\n\nPuede escribir el número o el nombre, por ejemplo:\n"Colecistectomía".`
        );
        return res.type('text/xml').send(msg.toString());
      }

      if (body === '2') {
        const ahoraISO = dayjs().tz(TIMEZONE).toISOString();
        let list = await Data.listDoctorReservations(state.doctor.id, { fromISO: ahoraISO });

        if (!list.length) {
          msg.message('📂 No tiene reservas próximas.\n\n¿Desea agendar una? (responda 1)');
          return res.type('text/xml').send(msg.toString());
        }

        list = list.slice(0, 10);
        const pretty = await Data.hydrateReservations(list);
        const lines = pretty.map(r => {
          const ini = dayjs(r.start_iso).tz(TIMEZONE).format('HH:mm');
          const fin = dayjs(r.end_iso).tz(TIMEZONE).format('HH:mm');
          const fecha = formatFechaCorta(r.start_iso);
          return `• ${fecha} ${ini} – ${fin} | ${r.or_name} | ${r.proc_name}`;
        }).join('\n');

        msg.message(
          `Estas son sus próximas reservas, doctor:\n\n${lines}\n\n` +
          `¿Desea cancelar alguna o agendar otra?`
        );
        return res.type('text/xml').send(msg.toString());
      }

      if (body === '3') {
        const ahoraISO = dayjs().tz(TIMEZONE).toISOString();
        let list = await Data.listDoctorReservations(state.doctor.id, { fromISO: ahoraISO });

        if (!list.length) {
          msg.message('📂 No tiene reservas próximas para cancelar.\n\n¿Desea agendar una nueva? (responda 1)');
          return res.type('text/xml').send(msg.toString());
        }

        list = list.slice(0, 10);
        const pretty = await Data.hydrateReservations(list);
        const lines = pretty.map((r, i) => {
          const fecha = formatFechaCorta(r.start_iso);
          return `${i + 1}) ${fecha} | ${r.or_name} | ${r.proc_name}`;
        }).join('\n');

        msg.message(
          `Claro, estas son sus próximas reservas:\n\n${lines}\n\n` +
          `Indique el número de la reserva que desea cancelar o escriba "salir".`
        );
        setSession(from, { step: 'CANCEL_SELECT', doctor: state.doctor, payload: { list: pretty } });
        return res.type('text/xml').send(msg.toString());
      }

      // Detectar intención de reserva en lenguaje natural
      if (detectBookingIntent(body)) {
        const procs = await Data.listProcedures();
        const ors = await Data.listORs();
        
        const detectedDate = extractDateFromText(body);
        const detectedProc = extractProcedureFromText(body, procs);
        const detectedOR = extractORFromText(body, ors);

        // Construir contexto parcial
        const partial = {};
        if (detectedDate) partial.dateISO = detectedDate;
        if (detectedProc) partial.procedure = detectedProc;
        if (detectedOR) partial.or = detectedOR;

        // Determinar qué falta
        const needsOR = !partial.or;
        const needsProc = !partial.procedure;
        const needsDate = !partial.dateISO;

        if (needsOR || needsProc) {
          // Pedir lo que falta
          let message = `Perfecto, doctor. `;
          
          if (needsProc && needsOR) {
            message += `Para proporcionarle los horarios necesito que me confirme:\n\n`;
            message += `El quirófano:\n` + ors.map(o => `${o.id}) ${o.name}`).join('\n');
            message += `\n\nY el procedimiento:\n` + procs.map((p, i) => {
              const letter = String.fromCharCode(65 + i); // A, B, C...
              return `${letter}) ${p.name} (${p.duration_min} min)`;
            }).join('\n');
            message += `\n\nPuede responder ambos juntos, por ejemplo: "2C"`;
          } else if (needsProc) {
            message += `¿Qué procedimiento desea realizar?\n\n`;
            message += procs.map((p, i) => {
              const letter = String.fromCharCode(65 + i);
              return `${letter}) ${p.name} (${p.duration_min} min)`;
            }).join('\n');
          } else if (needsOR) {
            message += `¿En qué quirófano desea realizarlo?\n\n`;
            message += ors.map(o => `${o.id}) ${o.name}`).join('\n');
          }

          setSession(from, { step: 'NL_COMPLETE', doctor: state.doctor, payload: { partial } });
          msg.message(message);
          return res.type('text/xml').send(msg.toString());
        }

        // Si tenemos todo, pasar a mostrar horarios
        if (!needsDate) {
          const slots = await getAvailableSlots(partial.or.id, partial.dateISO, partial.procedure.duration_min);
          
          if (!slots.length) {
            msg.message('⛔ No hay horarios disponibles ese día.\n\n¿Desea probar con otra fecha?');
            setSession(from, { step: 'DATE', doctor: state.doctor, payload: { procedure: partial.procedure, or: partial.or } });
            return res.type('text/xml').send(msg.toString());
          }

          setSession(from, { 
            step: 'SLOT', 
            doctor: state.doctor, 
            payload: { procedure: partial.procedure, or: partial.or, dateISO: partial.dateISO, slots } 
          });
          
          const lista = slots.slice(0, 10).map((s, i) => `${i + 1}️⃣ ${s.label}`).join('\n');
          msg.message(
            `Veamos los horarios disponibles para ${partial.or.name} el ${formatFechaES(partial.dateISO)}…\n\n` +
            `Tengo estos espacios:\n\n${lista}\n\n` +
            `Por favor, elija el número del horario que más le convenga.`
          );
          return res.type('text/xml').send(msg.toString());
        } else {
          // Falta fecha
          setSession(from, { step: 'DATE', doctor: state.doctor, payload: { procedure: partial.procedure, or: partial.or } });
          msg.message(
            `Entendido 🏥\n` +
            `¿Qué día desea reservar?\n\n` +
            `Puede escribirlo así:\n` +
            `• 29 de octubre\n` +
            `• 29/10`
          );
          return res.type('text/xml').send(msg.toString());
        }
      }

      // Opción inválida
      msg.message(
        `Puedo ayudarle con:\n` +
        `1️⃣ Reservar quirófano\n` +
        `2️⃣ Ver sus próximas reservas\n` +
        `3️⃣ Cancelar una reserva\n\n` +
        `¿Con cuál comenzamos?`
      );
      return res.type('text/xml').send(msg.toString());
    }

    // =======================
    // Completar solicitud en lenguaje natural
    // =======================
    if (state.step === 'NL_COMPLETE') {
      const partial = state.payload.partial || {};
      const procs = await Data.listProcedures();
      const ors = await Data.listORs();

      // Extraer procedimiento y quirófano del mensaje
      const detectedProc = extractProcedureFromText(body, procs);
      const detectedOR = extractORFromText(body, ors);

      if (detectedProc) partial.procedure = detectedProc;
      if (detectedOR) partial.or = detectedOR;

      // Verificar si ya tenemos todo
      if (partial.or && partial.procedure) {
        // Si falta fecha, pedirla
        if (!partial.dateISO) {
          setSession(from, { step: 'DATE', doctor: state.doctor, payload: { procedure: partial.procedure, or: partial.or } });
          msg.message(
            `Entendido 🏥\n` +
            `¿Qué día desea reservar?\n\n` +
            `Puede escribirlo así:\n` +
            `• 29 de octubre\n` +
            `• 29/10`
          );
          return res.type('text/xml').send(msg.toString());
        }

        // Si tenemos todo, mostrar horarios
        const slots = await getAvailableSlots(partial.or.id, partial.dateISO, partial.procedure.duration_min);
        
        if (!slots.length) {
          msg.message('⛔ No hay horarios disponibles ese día.\n\n¿Desea probar con otra fecha?');
          setSession(from, { step: 'DATE', doctor: state.doctor, payload: { procedure: partial.procedure, or: partial.or } });
          return res.type('text/xml').send(msg.toString());
        }

        setSession(from, { 
          step: 'SLOT', 
          doctor: state.doctor, 
          payload: { procedure: partial.procedure, or: partial.or, dateISO: partial.dateISO, slots } 
        });
        
        const lista = slots.slice(0, 10).map((s, i) => `${i + 1}️⃣ ${s.label}`).join('\n');
        msg.message(
          `Veamos los horarios disponibles para ${partial.or.name} el ${formatFechaES(partial.dateISO)}…\n\n` +
          `Tengo estos espacios:\n\n${lista}\n\n` +
          `Por favor, elija el número del horario que más le convenga.`
        );
        return res.type('text/xml').send(msg.toString());
      }

      // Aún falta información
      msg.message('⛔ No pude identificar la información. Por favor responda con el formato indicado.');
      return res.type('text/xml').send(msg.toString());
    }

    // =======================
    // Paso 1: Procedimiento
    // =======================
    if (state.step === 'PROC') {
      const procs = await Data.listProcedures();

      // Aceptar por ID o por nombre
      const byId   = procs.find(p => String(p.id) === body.trim());
      const byName = procs.find(p => (p.name || '').toLowerCase().includes(body.toLowerCase()));
      const proc = byId || byName;

      if (!proc) {
        msg.message('⛔ No encontré ese procedimiento.\n\nEscriba el número o el nombre tal como aparece en la lista.');
        return res.type('text/xml').send(msg.toString());
      }

      const ors = await Data.listORs();
      setSession(from, { step: 'OR', doctor: state.doctor, payload: { procedure: proc } });
      msg.message(
        `Excelente, el procedimiento será ${proc.name} (${proc.duration_min} min).\n` +
        `¿En qué quirófano desea realizarlo?\n\n` +
        ors.map(o => `${o.id}) ${o.name}`).join('\n')
      );
      return res.type('text/xml').send(msg.toString());
    }

    // =======================
    // Paso 2: Quirófano
    // =======================
    if (state.step === 'OR') {
      const ors = await Data.listORs();

      // Aceptar por ID o nombre
      const byId   = ors.find(o => String(o.id) === body.trim());
      const byName = ors.find(o => (o.name || '').toLowerCase() === body.toLowerCase());
      const orSel = byId || byName;

      if (!orSel) {
        msg.message('⛔ ID/Nombre de quirófano no válido.\n\nElija uno de la lista o escriba su nombre tal cual aparece.');
        return res.type('text/xml').send(msg.toString());
      }

      setSession(from, { 
        step: 'DATE', 
        doctor: state.doctor, 
        payload: { procedure: state.payload.procedure, or: orSel } 
      });
      msg.message(
        `Entendido 🏥\n` +
        `¿Qué día desea reservar?\n\n` +
        `Puede escribirlo así:\n` +
        `• 29 de octubre\n` +
        `• 29/10`
      );
      return res.type('text/xml').send(msg.toString());
    }

    // =======================
    // Paso 3: Fecha
    // =======================
    if (state.step === 'DATE') {
      const parsedISO = parseDateNaturalOrISO(body, new Date());
      if (!parsedISO) {
        msg.message('⛔ Formato de fecha no válido.\n\nUse DD/MM o el nombre del mes (ej: 29 de octubre).');
        return res.type('text/xml').send(msg.toString());
      }

      const today = dayjs().tz(TIMEZONE).startOf('day');
      const selected = dayjs.tz(parsedISO + ' 00:00', TIMEZONE);
      if (selected.isBefore(today)) {
        msg.message('⛔ Esa fecha ya pasó, doctor.\n\nPor favor indique una fecha a partir de hoy.');
        return res.type('text/xml').send(msg.toString());
      }

      const procedure = state.payload.procedure;
      const or = state.payload.or;
      const slots = await getAvailableSlots(or.id, parsedISO, procedure.duration_min);

      if (!slots.length) {
        msg.message('⛔ No hay horarios disponibles ese día.\n\n¿Desea probar con otra fecha?');
        return res.type('text/xml').send(msg.toString());
      }

      setSession(from, { 
        step: 'SLOT', 
        doctor: state.doctor, 
        payload: { procedure, or, dateISO: parsedISO, slots } 
      });
      
      const lista = slots.slice(0, 10).map((s, i) => `${i + 1}️⃣ ${s.label}`).join('\n');
      msg.message(
        `Veamos los horarios disponibles para ${or.name} el ${formatFechaES(parsedISO)}…\n\n` +
        `Tengo estos espacios:\n\n${lista}\n\n` +
        `Por favor, elija el número del horario que más le convenga.`
      );
      return res.type('text/xml').send(msg.toString());
    }

    // =======================
    // Paso 4: Selección de horario
    // =======================
    if (state.step === 'SLOT') {
      const payload = state.payload;
      const slots = payload.slots;

      if (body.toLowerCase() === 'ver') {
        const lista = slots.slice(0, 10).map((s, i) => `${i + 1}️⃣ ${s.label}`).join('\n');
        msg.message('🕐 Horarios disponibles:\n\n' + lista + '\n\nElija el número.');
        return res.type('text/xml').send(msg.toString());
      }

      const n = parseInt(body.trim(), 10);
      if (!Number.isInteger(n) || n < 1 || n > slots.length) {
        msg.message('⛔ Opción inválida.\n\nEscriba un número válido de la lista.');
        return res.type('text/xml').send(msg.toString());
      }

      const chosen = slots[n - 1];
      const r = await Data.createReservation({
        orId: payload.or.id,
        doctorId: state.doctor.id,
        procedureId: payload.procedure.id,
        startISO: chosen.startISO,
        endISO: chosen.endISO
      });

      if (r.conflict) {
        // Recalcular por si se ocupó justo ahora
        const slots2 = await getAvailableSlots(payload.or.id, payload.dateISO, payload.procedure.duration_min);
        if (!slots2.length) {
          clearSession(from);
          msg.message('❌ Ese horario se acaba de ocupar y ya no hay más disponibles ese día.\n\n¿Puedo ayudarle con otra fecha?');
          return res.type('text/xml').send(msg.toString());
        }
        setSession(from, { step: 'SLOT', doctor: state.doctor, payload: { ...payload, slots: slots2 } });
        const lista2 = slots2.slice(0, 10).map((s, i) => `${i + 1}️⃣ ${s.label}`).join('\n');
        msg.message('⚠️ Ese horario se ocupó justo ahora.\n\n🕐 Opciones disponibles:\n\n' + lista2 + '\n\nElija el número.');
        return res.type('text/xml').send(msg.toString());
      }

      // Confirmación final (sin pregunta de recordatorio)
      msg.message(
        `Perfecto ✅\n` +
        `Su reserva ha sido creada con éxito:\n\n` +
        `Doctor: ${state.doctor.name}\n` +
        `Procedimiento: ${payload.procedure.name}\n` +
        `Quirófano: ${payload.or.name}\n` +
        `Fecha: ${formatFechaES(payload.dateISO)}\n` +
        `Hora: ${chosen.label}\n` +
        `Folio: ${r.id}\n\n` +
        `💡 Ya que conoce los pasos, la próxima vez puede solicitar una reserva en una sola oración.\n\n` +
        `Por ejemplo:\n` +
        `"Quiero agendar una colecistectomía para el 24 de octubre".\n\n` +
        `Así podré procesarlo automáticamente para agilizar su solicitud.\n\n` +
        `¿Puedo ayudarle con algo más hoy?`
      );
      clearSession(from);
      return res.type('text/xml').send(msg.toString());
    }

    // =======================
    // Cancelación (selección)
    // =======================
    if (state.step === 'CANCEL_SELECT') {
      const payload = state.payload || {};
      const list = Array.isArray(payload.list) ? payload.list : [];

      if (body.toLowerCase() === 'salir') {
        clearSession(from);
        msg.message('Operación cancelada.\n\n¿Puedo ayudarle con algo más hoy?');
        return res.type('text/xml').send(msg.toString());
      }

      const n = parseInt(body.trim(), 10);
      if (!Number.isInteger(n) || n < 1 || n > list.length) {
        msg.message(`⛔ Opción inválida.\n\nEscriba un número (1-${list.length}) o "salir".`);
        return res.type('text/xml').send(msg.toString());
      }

      const chosen = list[n - 1];
      try {
        await Data.cancelReservation(chosen.id);
        clearSession(from);
        msg.message(
          `Entendido, su reserva Folio ${chosen.id} fue cancelada correctamente.\n\n` +
          `¿Desea crear una nueva o ver sus próximas reservas?`
        );
      } catch (e) {
        console.error('Cancel error:', e);
        clearSession(from);
        msg.message('⚠️ No pude cancelar en este momento. Intente de nuevo.\n\n¿Puedo ayudarle con algo más hoy?');
      }
      return res.type('text/xml').send(msg.toString());
    }

    // =======================
    // Fallback
    // =======================
    msg.message('No le entendí. Escriba "reset" para volver al menú.\n\n¿Puedo ayudarle con algo más hoy?');
    return res.type('text/xml').send(msg.toString());

  } catch (error) {
    console.error('❌ Error en /whatsapp:', error);
    console.error('Stack:', error.stack);
    
    // Intentar responder con mensaje de error
    try {
      msg.message('⚠️ Hubo un error procesando su solicitud. Por favor escriba "reset" para reiniciar.');
      console.log('📤 OUT: Error recovery message');
      return res.type('text/xml').send(msg.toString());
    } catch (sendError) {
      console.error('❌ No se pudo enviar mensaje de error:', sendError);
      // Enviar respuesta vacía para que Twilio no reintente
      return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
  }
});

// Middleware de error global
app.use((err, req, res, next) => {
  console.error('❌ Error no capturado:', err);
  res.status(500).send('Error interno del servidor');
});

app.listen(3000, () => console.log('✅ Servidor listo: http://localhost:3000'));