/**
 * handlers/whatsapp.js
 * Controlador completo del webhook de WhatsApp
 * TODO EN UN SOLO ARCHIVO para máxima claridad
 */

const { MessagingResponse } = require('twilio').twiml;
const { setSession, getSession, clearSession } = require('../services/sessions');
const { getAvailableSlots } = require('../services/agenda');
const { formatFechaES, formatFechaCorta, dayjs, TIMEZONE } = require('../utils/dates');
const { parseDateNaturalOrISO } = require('../utils/dates');
const {
  detectBookingIntent,
  extractDateFromText,
  extractProcedureFromText,
  extractORFromText
} = require('../utils/natural-language');
const Sheets = require('../services/sheets');

/**
 * Handler principal del webhook
 */
async function handleWhatsApp(req, res) {
  const from = (req.body?.From || '').replace('whatsapp:', '');
  const body = (req.body?.Body || '').trim();
  const msg = new MessagingResponse();
  
  console.log('🔥 IN:', from, body);

  try {
    // ========================================
    // COMANDO RESET
    // ========================================
    if (body.toLowerCase() === 'reset') {
      clearSession(from);
      const doc = await Sheets.getDoctorByPhone(from);
      
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
      
      console.log('📤 OUT: RESET');
      return res.type('text/xml').send(msg.toString());
    }

    // ========================================
    // OBTENER O INICIAR SESIÓN
    // ========================================
    const doctor = await Sheets.getDoctorByPhone(from);
    let state = getSession(from);

    if (!state) {
      // Primera interacción
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

    // ========================================
    // MENÚ PÚBLICO (DEMO)
    // ========================================
    if (state.step === 'MENU_PUB') {
      if (body === '1') msg.message('📋 Directorio médico (demo)');
      else if (body === '2') msg.message('🏥 Servicios (demo)');
      else if (body === '3') msg.message('📅 Agendar cita (demo)');
      else msg.message('👋 Opciones:\n1) Directorio médico\n2) Servicios\n3) Agendar cita');
      
      console.log('📤 OUT: Public menu');
      return res.type('text/xml').send(msg.toString());
    }

    // ========================================
    // MENÚ DOCTOR
    // ========================================
    if (state.step === 'MENU_DOC') {
      // Opción 1: Reservar
      if (body === '1') {
        const procs = await Sheets.listProcedures();
        setSession(from, { step: 'PROC', doctor: state.doctor });
        msg.message(
          `Perfecto, doctor.\n` +
          `¿Qué procedimiento desea realizar?\n\n` +
          `Aquí tiene la lista disponible 👇\n\n` +
          procs.map((p, i) => `${p.id}) ${p.name} (${p.duration_min} min)`).join('\n') +
          `\n\nPuede escribir el número o el nombre, por ejemplo:\n"Colecistectomía".`
        );
        console.log('📤 OUT: Procedure list');
        return res.type('text/xml').send(msg.toString());
      }

      // Opción 2: Ver reservas
      if (body === '2') {
        const ahoraISO = dayjs().tz(TIMEZONE).toISOString();
        let list = await Sheets.listDoctorReservations(state.doctor.id, { fromISO: ahoraISO });

        if (!list.length) {
          msg.message('📂 No tiene reservas próximas.\n\n¿Desea agendar una? (responda 1)');
          console.log('📤 OUT: No reservations');
          return res.type('text/xml').send(msg.toString());
        }

        list = list.slice(0, 10);
        const pretty = await Sheets.hydrateReservations(list);
        const lines = pretty.map(r => {
          const ini = dayjs(r.start_iso).tz(TIMEZONE).format('HH:mm');
          const fin = dayjs(r.end_iso).tz(TIMEZONE).format('HH:mm');
          const fecha = formatFechaCorta(r.start_iso);
          return `• ${fecha} ${ini} — ${fin} | ${r.or_name} | ${r.proc_name}`;
        }).join('\n');

        msg.message(
          `Estas son sus próximas reservas, doctor:\n\n${lines}\n\n` +
          `¿Desea cancelar alguna o agendar otra?`
        );
        console.log('📤 OUT: Reservations list');
        return res.type('text/xml').send(msg.toString());
      }

      // Opción 3: Cancelar
      if (body === '3') {
        const ahoraISO = dayjs().tz(TIMEZONE).toISOString();
        let list = await Sheets.listDoctorReservations(state.doctor.id, { fromISO: ahoraISO });

        if (!list.length) {
          msg.message('📂 No tiene reservas próximas para cancelar.\n\n¿Desea agendar una nueva? (responda 1)');
          console.log('📤 OUT: No reservations to cancel');
          return res.type('text/xml').send(msg.toString());
        }

        list = list.slice(0, 10);
        const pretty = await Sheets.hydrateReservations(list);
        const lines = pretty.map((r, i) => {
          const fecha = formatFechaCorta(r.start_iso);
          return `${i + 1}) ${fecha} | ${r.or_name} | ${r.proc_name}`;
        }).join('\n');

        msg.message(
          `Claro, estas son sus próximas reservas:\n\n${lines}\n\n` +
          `Indique el número de la reserva que desea cancelar o escriba "salir".`
        );
        setSession(from, { step: 'CANCEL_SELECT', doctor: state.doctor, payload: { list: pretty } });
        console.log('📤 OUT: Cancel menu');
        return res.type('text/xml').send(msg.toString());
      }

      // Detectar lenguaje natural para reserva
      if (detectBookingIntent(body)) {
        const procs = await Sheets.listProcedures();
        const ors = await Sheets.listORs();
        
        const detectedDate = extractDateFromText(body);
        const detectedProc = extractProcedureFromText(body, procs);
        const detectedOR = extractORFromText(body, ors);

        const partial = {};
        if (detectedDate) partial.dateISO = detectedDate;
        if (detectedProc) partial.procedure = detectedProc;
        if (detectedOR) partial.or = detectedOR;

        const needsOR = !partial.or;
        const needsProc = !partial.procedure;
        const needsDate = !partial.dateISO;

        // Si falta procedimiento o quirófano
        if (needsOR || needsProc) {
          let message = `Perfecto, doctor. `;
          
          if (needsProc && needsOR) {
            message += `Para proporcionarle los horarios necesito que me confirme:\n\n`;
            message += `El quirófano:\n` + ors.map(o => `${o.id}) ${o.name}`).join('\n');
            message += `\n\nY el procedimiento:\n` + procs.map((p, i) => {
              const letter = String.fromCharCode(65 + i);
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
          console.log('📤 OUT: NL partial info');
          return res.type('text/xml').send(msg.toString());
        }

        // Si falta solo la fecha
        if (needsDate) {
          setSession(from, { step: 'DATE', doctor: state.doctor, payload: { procedure: partial.procedure, or: partial.or } });
          msg.message(
            `Entendido 🏥\n` +
            `¿Qué día desea reservar?\n\n` +
            `Puede escribirlo así:\n` +
            `• 29 de octubre\n` +
            `• 29/10`
          );
          console.log('📤 OUT: Ask for date');
          return res.type('text/xml').send(msg.toString());
        }

        // Tenemos todo, mostrar slots
        const slots = await getAvailableSlots(partial.or.id, partial.dateISO, partial.procedure.duration_min);
        
        if (!slots.length) {
          msg.message('⛔ No hay horarios disponibles ese día.\n\n¿Desea probar con otra fecha?');
          setSession(from, { step: 'DATE', doctor: state.doctor, payload: { procedure: partial.procedure, or: partial.or } });
          console.log('📤 OUT: No slots available');
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
        console.log('📤 OUT: Available slots');
        return res.type('text/xml').send(msg.toString());
      }

      // Opción inválida
      msg.message(
        `Puedo ayudarle con:\n` +
        `1️⃣ Reservar quirófano\n` +
        `2️⃣ Ver sus próximas reservas\n` +
        `3️⃣ Cancelar una reserva\n\n` +
        `¿Con cuál comenzamos?`
      );
      console.log('📤 OUT: Invalid option');
      return res.type('text/xml').send(msg.toString());
    }

    // ========================================
    // COMPLETAR INFO EN LENGUAJE NATURAL
    // ========================================
    if (state.step === 'NL_COMPLETE') {
      const partial = state.payload.partial || {};
      const procs = await Sheets.listProcedures();
      const ors = await Sheets.listORs();

      const detectedProc = extractProcedureFromText(body, procs);
      const detectedOR = extractORFromText(body, ors);

      if (detectedProc) partial.procedure = detectedProc;
      if (detectedOR) partial.or = detectedOR;

      if (partial.or && partial.procedure) {
        if (!partial.dateISO) {
          setSession(from, { step: 'DATE', doctor: state.doctor, payload: { procedure: partial.procedure, or: partial.or } });
          msg.message(
            `Entendido 🏥\n` +
            `¿Qué día desea reservar?\n\n` +
            `Puede escribirlo así:\n` +
            `• 29 de octubre\n` +
            `• 29/10`
          );
          console.log('📤 OUT: Ask for date');
          return res.type('text/xml').send(msg.toString());
        }

        const slots = await getAvailableSlots(partial.or.id, partial.dateISO, partial.procedure.duration_min);
        
        if (!slots.length) {
          msg.message('⛔ No hay horarios disponibles ese día.\n\n¿Desea probar con otra fecha?');
          setSession(from, { step: 'DATE', doctor: state.doctor, payload: { procedure: partial.procedure, or: partial.or } });
          console.log('📤 OUT: No slots');
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
        console.log('📤 OUT: Slots after completion');
        return res.type('text/xml').send(msg.toString());
      }

      msg.message('⛔ No pude identificar la información. Por favor responda con el formato indicado.');
      console.log('📤 OUT: Could not parse');
      return res.type('text/xml').send(msg.toString());
    }

    // ========================================
    // PASO 1: SELECCIÓN DE PROCEDIMIENTO
    // ========================================
    if (state.step === 'PROC') {
      const procs = await Sheets.listProcedures();
      const byId = procs.find(p => String(p.id) === body.trim());
      const byName = procs.find(p => (p.name || '').toLowerCase().includes(body.toLowerCase()));
      const proc = byId || byName;

      if (!proc) {
        msg.message('⛔ No encontré ese procedimiento.\n\nEscriba el número o el nombre tal como aparece en la lista.');
        console.log('📤 OUT: Invalid procedure');
        return res.type('text/xml').send(msg.toString());
      }

      const ors = await Sheets.listORs();
      setSession(from, { step: 'OR', doctor: state.doctor, payload: { procedure: proc } });
      msg.message(
        `Excelente, el procedimiento será ${proc.name} (${proc.duration_min} min).\n` +
        `¿En qué quirófano desea realizarlo?\n\n` +
        ors.map(o => `${o.id}) ${o.name}`).join('\n')
      );
      console.log('📤 OUT: Procedure selected');
      return res.type('text/xml').send(msg.toString());
    }

    // ========================================
    // PASO 2: SELECCIÓN DE QUIRÓFANO
    // ========================================
    if (state.step === 'OR') {
      const ors = await Sheets.listORs();
      const byId = ors.find(o => String(o.id) === body.trim());
      const byName = ors.find(o => (o.name || '').toLowerCase() === body.toLowerCase());
      const orSel = byId || byName;

      if (!orSel) {
        msg.message('⛔ ID/Nombre de quirófano no válido.\n\nElija uno de la lista o escriba su nombre tal cual aparece.');
        console.log('📤 OUT: Invalid OR');
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
      console.log('📤 OUT: OR selected');
      return res.type('text/xml').send(msg.toString());
    }

    // ========================================
    // PASO 3: SELECCIÓN DE FECHA
    // ========================================
    if (state.step === 'DATE') {
      const parsedISO = parseDateNaturalOrISO(body, new Date());
      if (!parsedISO) {
        msg.message('⛔ Formato de fecha no válido.\n\nUse DD/MM o el nombre del mes (ej: 29 de octubre).');
        console.log('📤 OUT: Invalid date format');
        return res.type('text/xml').send(msg.toString());
      }

      const today = dayjs().tz(TIMEZONE).startOf('day');
      const selected = dayjs.tz(parsedISO + ' 00:00', TIMEZONE);
      if (selected.isBefore(today)) {
        msg.message('⛔ Esa fecha ya pasó, doctor.\n\nPor favor indique una fecha a partir de hoy.');
        console.log('📤 OUT: Past date');
        return res.type('text/xml').send(msg.toString());
      }

      const procedure = state.payload.procedure;
      const or = state.payload.or;
      const slots = await getAvailableSlots(or.id, parsedISO, procedure.duration_min);

      if (!slots.length) {
        msg.message('⛔ No hay horarios disponibles ese día.\n\n¿Desea probar con otra fecha?');
        console.log('📤 OUT: No slots for date');
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
      console.log('📤 OUT: Slots for selected date');
      return res.type('text/xml').send(msg.toString());
    }

    // ========================================
    // PASO 4: SELECCIÓN DE HORARIO Y CONFIRMACIÓN
    // ========================================
    if (state.step === 'SLOT') {
      const payload = state.payload;
      const slots = payload.slots;

      if (body.toLowerCase() === 'ver') {
        const lista = slots.slice(0, 10).map((s, i) => `${i + 1}️⃣ ${s.label}`).join('\n');
        msg.message('🕐 Horarios disponibles:\n\n' + lista + '\n\nElija el número.');
        console.log('📤 OUT: Show slots again');
        return res.type('text/xml').send(msg.toString());
      }

      const n = parseInt(body.trim(), 10);
      if (!Number.isInteger(n) || n < 1 || n > slots.length) {
        msg.message('⛔ Opción inválida.\n\nEscriba un número válido de la lista.');
        console.log('📤 OUT: Invalid slot number');
        return res.type('text/xml').send(msg.toString());
      }

      const chosen = slots[n - 1];
      const r = await Sheets.createReservation({
        orId: payload.or.id,
        doctorId: state.doctor.id,
        procedureId: payload.procedure.id,
        startISO: chosen.startISO,
        endISO: chosen.endISO
      });

      if (r.conflict) {
        const slots2 = await getAvailableSlots(payload.or.id, payload.dateISO, payload.procedure.duration_min);
        if (!slots2.length) {
          clearSession(from);
          msg.message('❌ Ese horario se acaba de ocupar y ya no hay más disponibles ese día.\n\n¿Puedo ayudarle con otra fecha?');
          console.log('📤 OUT: Conflict, no more slots');
          return res.type('text/xml').send(msg.toString());
        }
        setSession(from, { step: 'SLOT', doctor: state.doctor, payload: { ...payload, slots: slots2 } });
        const lista2 = slots2.slice(0, 10).map((s, i) => `${i + 1}️⃣ ${s.label}`).join('\n');
        msg.message('⚠️ Ese horario se ocupó justo ahora.\n\n🕐 Opciones disponibles:\n\n' + lista2 + '\n\nElija el número.');
        console.log('📤 OUT: Conflict, show new slots');
        return res.type('text/xml').send(msg.toString());
      }

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
      console.log('📤 OUT: Reservation confirmed');
      return res.type('text/xml').send(msg.toString());
    }

    // ========================================
    // CANCELACIÓN
    // ========================================
    if (state.step === 'CANCEL_SELECT') {
      const payload = state.payload || {};
      const list = Array.isArray(payload.list) ? payload.list : [];

      if (body.toLowerCase() === 'salir') {
        clearSession(from);
        msg.message('Operación cancelada.\n\n¿Puedo ayudarle con algo más hoy?');
        console.log('📤 OUT: Cancel operation cancelled');
        return res.type('text/xml').send(msg.toString());
      }

      const n = parseInt(body.trim(), 10);
      if (!Number.isInteger(n) || n < 1 || n > list.length) {
        msg.message(`⛔ Opción inválida.\n\nEscriba un número (1-${list.length}) o "salir".`);
        console.log('📤 OUT: Invalid cancel option');
        return res.type('text/xml').send(msg.toString());
      }

      const chosen = list[n - 1];
      try {
        await Sheets.cancelReservation(chosen.id);
        clearSession(from);
        msg.message(
          `Entendido, su reserva Folio ${chosen.id} fue cancelada correctamente.\n\n` +
          `¿Desea crear una nueva o ver sus próximas reservas?`
        );
        console.log('📤 OUT: Reservation cancelled');
      } catch (e) {
        console.error('Cancel error:', e);
        clearSession(from);
        msg.message('⚠️ No pude cancelar en este momento. Intente de nuevo.\n\n¿Puedo ayudarle con algo más hoy?');
        console.log('📤 OUT: Cancel error');
      }
      return res.type('text/xml').send(msg.toString());
    }

    // ========================================
    // FALLBACK
    // ========================================
    msg.message('No le entendí. Escriba "reset" para volver al menú.\n\n¿Puedo ayudarle con algo más hoy?');
    console.log('📤 OUT: Fallback');
    return res.type('text/xml').send(msg.toString());

  } catch (error) {
    console.error('❌ Error en /whatsapp:', error);
    console.error('Stack:', error.stack);
    
    try {
      msg.message('⚠️ Hubo un error procesando su solicitud. Por favor escriba "reset" para reiniciar.');
      console.log('📤 OUT: Error recovery');
      return res.type('text/xml').send(msg.toString());
    } catch (sendError) {
      console.error('❌ No se pudo enviar mensaje de error:', sendError);
      return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
  }
}

module.exports = { handleWhatsApp };