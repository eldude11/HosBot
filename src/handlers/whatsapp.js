const { twiml: { MessagingResponse } } = require('twilio');
const { dayjs, TIMEZONE } = require('../config');
const { listProcedures, listORs, getDoctorByPhone } = require('../data/sheets');
const { listDoctorReservations, hydrateReservations, createReservation } = require('../data/storage');
const { getAvailableSlots } = require('../services/agenda');
const { setSession, getSession, clearSession } = require('../services/sessions');
const {
  parseDateNaturalOrISO,
  formatFechaES,
  formatFechaCorta
} = require('../utils/date');

// NLU helpers (id�nticos a tu script)
function detectBookingIntent(text) {
  const lower = (text || '').toLowerCase();
  const keywords = ['reservar','agendar','reserva','cita','quirofano','quir�fano','cirugia','cirug�a','procedimiento'];
  return keywords.some(k => lower.includes(k));
}
function extractProcedureFromText(text, procedures) {
  const lower = (text || '').toLowerCase();
  const idMatch = text.match(/\b(\d+)\b/);
  if (idMatch) {
    const proc = procedures.find(p => String(p.id) === idMatch[1]);
    if (proc) return proc;
  }
  for (const proc of procedures) {
    if (lower.includes(proc.name.toLowerCase())) return proc;
  }
  const letterMatch = text.match(/\b([A-Z])\b/i);
  if (letterMatch) {
    const letterIndex = letterMatch[1].toUpperCase().charCodeAt(0) - 65;
    if (letterIndex >= 0 && letterIndex < procedures.length) return procedures[letterIndex];
  }
  return null;
}
function extractORFromText(text, ors) {
  const lower = (text || '').toLowerCase();
  const idMatch = text.match(/\b(\d+)\b/);
  if (idMatch) {
    const or = ors.find(o => String(o.id) === idMatch[1]);
    if (or) return or;
  }
  for (const or of ors) {
    if (lower.includes(or.name.toLowerCase())) return or;
  }
  return null;
}

async function whatsappHandler(req, res) {
  // Forzar UTF-8 para Twilio (corrige �?�)
  res.set('Content-Type', 'text/xml; charset=utf-8');

  const from = (req.body?.From || '').replace('whatsapp:', '');
  const body = (req.body?.Body || '').trim();
  const msg  = new MessagingResponse();

  try {
    if ((body || '').toLowerCase() === 'reset') {
      clearSession(from);
      const doc = await getDoctorByPhone(from);
      if (doc) {
        setSession(from, { step: 'MENU_DOC', doctor: doc });
        msg.message(
          `?? �Hola ${doc.name}! Qu� gusto saludarle.\n` +
          `Soy su asistente quir�rgico digital.\n\n` +
          `Puedo ayudarle con:\n` +
          `1?? Reservar quir�fano\n` +
          `2?? Ver sus pr�ximas reservas\n` +
          `3?? Cancelar una reserva\n\n` +
          `�Con cu�l comenzamos?`
        );
      } else {
        setSession(from, { step: 'MENU_PUB' });
        msg.message('?? Bienvenido.\n1) Directorio m�dico\n2) Servicios\n3) Agendar cita');
      }
      return res.type('text/xml').send(msg.toString());
    }

    const doctor = await getDoctorByPhone(from);
    let state = getSession(from);

    if (!state) {
      if (doctor) {
        setSession(from, { step: 'MENU_DOC', doctor });
        msg.message(
          `?? �Hola ${doctor.name}! Qu� gusto saludarle.\n` +
          `Soy su asistente quir�rgico digital.\n\n` +
          `Puedo ayudarle con:\n` +
          `1?? Reservar quir�fano\n` +
          `2?? Ver sus pr�ximas reservas\n` +
          `3?? Cancelar una reserva\n\n` +
          `�Con cu�l comenzamos?`
        );
      } else {
        setSession(from, { step: 'MENU_PUB' });
        msg.message('?? Bienvenido.\n1) Directorio m�dico\n2) Servicios\n3) Agendar cita');
      }
      return res.type('text/xml').send(msg.toString());
    }

    if (state.step === 'MENU_PUB') {
      if (body === '1') msg.message('?? Directorio m�dico (demo)');
      else if (body === '2') msg.message('?? Servicios (demo)');
      else if (body === '3') msg.message('?? Agendar cita (demo)');
      else msg.message('?? Opciones:\n1) Directorio m�dico\n2) Servicios\n3) Agendar cita');
      return res.type('text/xml').send(msg.toString());
    }

    if (state.step === 'MENU_DOC') {
      if (body === '1') {
        const procs = await listProcedures();
        setSession(from, { step: 'PROC', doctor: state.doctor });
        msg.message(
          `Perfecto, doctor.\n` +
          `�Qu� procedimiento desea realizar?\n\n` +
          `Aqu� tiene la lista disponible ??\n\n` +
          procs.map((p) => `${p.id}) ${p.name} (${p.duration_min} min)`).join('\n') +
          `\n\nPuede escribir el n�mero o el nombre, por ejemplo:\n"Colecistectom�a".`
        );
        return res.type('text/xml').send(msg.toString());
      }

      if (body === '2') {
        const ahoraISO = dayjs().tz(TIMEZONE).toISOString();
        let list = await listDoctorReservations(state.doctor.id, { fromISO: ahoraISO });
        if (!list.length) {
          msg.message('?? No tiene reservas pr�ximas.\n\n�Desea agendar una? (responda 1)');
          return res.type('text/xml').send(msg.toString());
        }
        list = list.slice(0, 10);
        const pretty = await hydrateReservations(list);
        const lines = pretty.map(r => {
          const ini = dayjs(r.start_iso).tz(TIMEZONE).format('HH:mm');
          const fin = dayjs(r.end_iso).tz(TIMEZONE).format('HH:mm');
          const fecha = formatFechaCorta(r.start_iso);
          return `� ${fecha} ${ini} � ${fin} | ${r.or_name} | ${r.proc_name}`;
        }).join('\n');
        msg.message(`Estas son sus pr�ximas reservas, doctor:\n\n${lines}\n\n�Desea cancelar alguna o agendar otra?`);
        return res.type('text/xml').send(msg.toString());
      }

      if (body === '3') {
        const ahoraISO = dayjs().tz(TIMEZONE).toISOString();
        let list = await listDoctorReservations(state.doctor.id, { fromISO: ahoraISO });
        if (!list.length) {
          msg.message('?? No tiene reservas pr�ximas para cancelar.\n\n�Desea agendar una nueva? (responda 1)');
          return res.type('text/xml').send(msg.toString());
        }
        list = list.slice(0, 10);
        const pretty = await hydrateReservations(list);
        const lines = pretty.map((r, i) => {
          const fecha = formatFechaCorta(r.start_iso);
          return `${i + 1}) ${fecha} | ${r.or_name} | ${r.proc_name}`;
        }).join('\n');
        msg.message(
          `Claro, estas son sus pr�ximas reservas:\n\n${lines}\n\n` +
          `Indique el n�mero de la reserva que desea cancelar o escriba "salir".`
        );
        setSession(from, { step: 'CANCEL_SELECT', doctor: state.doctor, payload: { list: pretty } });
        return res.type('text/xml').send(msg.toString());
      }

      // Lenguaje natural
      if (detectBookingIntent(body)) {
        const procs = await listProcedures();
        const ors = await listORs();

        const detectedDate = parseDateNaturalOrISO(body);
        const detectedProc = extractProcedureFromText(body, procs);
        const detectedOR   = extractORFromText(body, ors);

        const partial = {};
        if (detectedDate) partial.dateISO = detectedDate;
        if (detectedProc) partial.procedure = detectedProc;
        if (detectedOR)   partial.or = detectedOR;

        const needsOR = !partial.or;
        const needsProc = !partial.procedure;
        const needsDate = !partial.dateISO;

        if (needsOR || needsProc) {
          let message = `Perfecto, doctor. `;
          if (needsProc && needsOR) {
            message += `Para proporcionarle los horarios necesito que me confirme:\n\n`;
            message += `El quir�fano:\n` + ors.map(o => `${o.id}) ${o.name}`).join('\n');
            message += `\n\nY el procedimiento:\n` + procs.map((p, i) => {
              const letter = String.fromCharCode(65 + i);
              return `${letter}) ${p.name} (${p.duration_min} min)`;
            }).join('\n');
            message += `\n\nPuede responder ambos juntos, por ejemplo: "2C"`;
          } else if (needsProc) {
            message += `�Qu� procedimiento desea realizar?\n\n`;
            message += procs.map((p, i) => {
              const letter = String.fromCharCode(65 + i);
              return `${letter}) ${p.name} (${p.duration_min} min)`;
            }).join('\n');
          } else if (needsOR) {
            message += `�En qu� quir�fano desea realizarlo?\n\n`;
            message += ors.map(o => `${o.id}) ${o.name}`).join('\n');
          }
          setSession(from, { step: 'NL_COMPLETE', doctor: state.doctor, payload: { partial } });
          msg.message(message);
          return res.type('text/xml').send(msg.toString());
        }

        if (!needsDate) {
          const slots = await getAvailableSlots(partial.or.id, partial.dateISO, partial.procedure.duration_min);
          if (!slots.length) {
            msg.message('? No hay horarios disponibles ese d�a.\n\n�Desea probar con otra fecha?');
            setSession(from, { step: 'DATE', doctor: state.doctor, payload: { procedure: partial.procedure, or: partial.or } });
            return res.type('text/xml').send(msg.toString());
          }
          setSession(from, { step: 'SLOT', doctor: state.doctor, payload: { procedure: partial.procedure, or: partial.or, dateISO: partial.dateISO, slots } });
          const lista = slots.slice(0, 10).map((s, i) => `${i + 1}?? ${s.label}`).join('\n');
          msg.message(
            `Veamos los horarios disponibles para ${partial.or.name} el ${formatFechaES(partial.dateISO)}�\n\n` +
            `Tengo estos espacios:\n\n${lista}\n\n` +
            `Por favor, elija el n�mero del horario que m�s le convenga.`
          );
          return res.type('text/xml').send(msg.toString());
        } else {
          setSession(from, { step: 'DATE', doctor: state.doctor, payload: { procedure: partial.procedure, or: partial.or } });
          msg.message(
            `Entendido ??\n` +
            `�Qu� d�a desea reservar?\n\n` +
            `Puede escribirlo as�:\n` +
            `� 29 de octubre\n` +
            `� 29/10`
          );
          return res.type('text/xml').send(msg.toString());
        }
      }

      msg.message(
        `Puedo ayudarle con:\n` +
        `1?? Reservar quir�fano\n` +
        `2?? Ver sus pr�ximas reservas\n` +
        `3?? Cancelar una reserva\n\n` +
        `�Con cu�l comenzamos?`
      );
      return res.type('text/xml').send(msg.toString());
    }

    if (state.step === 'NL_COMPLETE') {
      const partial = state.payload.partial || {};
      const procs = await listProcedures();
      const ors = await listORs();

      const detectedProc = extractProcedureFromText(body, procs);
      const detectedOR   = extractORFromText(body, ors);
      if (detectedProc) partial.procedure = detectedProc;
      if (detectedOR)   partial.or = detectedOR;

      if (partial.or && partial.procedure) {
        if (!partial.dateISO) {
          setSession(from, { step: 'DATE', doctor: state.doctor, payload: { procedure: partial.procedure, or: partial.or } });
          msg.message(
            `Entendido ??\n` +
            `�Qu� d�a desea reservar?\n\n` +
            `Puede escribirlo as�:\n` +
            `� 29 de octubre\n` +
            `� 29/10`
          );
          return res.type('text/xml').send(msg.toString());
        }
        const slots = await getAvailableSlots(partial.or.id, partial.dateISO, partial.procedure.duration_min);
        if (!slots.length) {
          msg.message('? No hay horarios disponibles ese d�a.\n\n�Desea probar con otra fecha?');
          setSession(from, { step: 'DATE', doctor: state.doctor, payload: { procedure: partial.procedure, or: partial.or } });
          return res.type('text/xml').send(msg.toString());
        }
        setSession(from, { step: 'SLOT', doctor: state.doctor, payload: { procedure: partial.procedure, or: partial.or, dateISO: partial.dateISO, slots } });
        const lista = slots.slice(0, 10).map((s, i) => `${i + 1}?? ${s.label}`).join('\n');
        msg.message(
          `Veamos los horarios disponibles para ${partial.or.name} el ${formatFechaES(partial.dateISO)}�\n\n` +
          `Tengo estos espacios:\n\n${lista}\n\n` +
          `Por favor, elija el n�mero del horario que m�s le convenga.`
        );
        return res.type('text/xml').send(msg.toString());
      }
      msg.message('? No pude identificar la informaci�n. Por favor responda con el formato indicado.');
      return res.type('text/xml').send(msg.toString());
    }

    if (state.step === 'PROC') {
      const procs = await listProcedures();
      const byId   = procs.find(p => String(p.id) === body.trim());
      const byName = procs.find(p => (p.name || '').toLowerCase().includes(body.toLowerCase()));
      const proc = byId || byName;
      if (!proc) {
        msg.message('? No encontr� ese procedimiento.\n\nEscriba el n�mero o el nombre tal como aparece en la lista.');
        return res.type('text/xml').send(msg.toString());
      }
      const ors = await listORs();
      setSession(from, { step: 'OR', doctor: state.doctor, payload: { procedure: proc } });
      msg.message(
        `Excelente, el procedimiento ser� ${proc.name} (${proc.duration_min} min).\n` +
        `�En qu� quir�fano desea realizarlo?\n\n` +
        ors.map(o => `${o.id}) ${o.name}`).join('\n')
      );
      return res.type('text/xml').send(msg.toString());
    }

    if (state.step === 'OR') {
      const ors = await listORs();
      const byId   = ors.find(o => String(o.id) === body.trim());
      const byName = ors.find(o => (o.name || '').toLowerCase() === body.toLowerCase());
      const orSel = byId || byName;
      if (!orSel) {
        msg.message('? ID/Nombre de quir�fano no v�lido.\n\nElija uno de la lista o escriba su nombre tal cual aparece.');
        return res.type('text/xml').send(msg.toString());
      }
      setSession(from, { step: 'DATE', doctor: state.doctor, payload: { procedure: state.payload.procedure, or: orSel } });
      msg.message(
        `Entendido ??\n` +
        `�Qu� d�a desea reservar?\n\n` +
        `Puede escribirlo as�:\n` +
        `� 29 de octubre\n` +
        `� 29/10`
      );
      return res.type('text/xml').send(msg.toString());
    }

    if (state.step === 'DATE') {
      const parsedISO = parseDateNaturalOrISO(body, new Date());
      if (!parsedISO) {
        msg.message('? Formato de fecha no v�lido.\n\nUse DD/MM o el nombre del mes (ej: 29 de octubre).');
        return res.type('text/xml').send(msg.toString());
      }
      const today = dayjs().tz(TIMEZONE).startOf('day');
      const selected = dayjs.tz(parsedISO + ' 00:00', TIMEZONE);
      if (selected.isBefore(today)) {
        msg.message('? Esa fecha ya pas�, doctor.\n\nPor favor indique una fecha a partir de hoy.');
        return res.type('text/xml').send(msg.toString());
      }
      const procedure = state.payload.procedure;
      const or = state.payload.or;
      const slots = await getAvailableSlots(or.id, parsedISO, procedure.duration_min);
      if (!slots.length) {
        msg.message('? No hay horarios disponibles ese d�a.\n\n�Desea probar con otra fecha?');
        return res.type('text/xml').send(msg.toString());
      }
      setSession(from, { step: 'SLOT', doctor: state.doctor, payload: { procedure, or, dateISO: parsedISO, slots } });
      const lista = slots.slice(0, 10).map((s, i) => `${i + 1}?? ${s.label}`).join('\n');
      msg.message(
        `Veamos los horarios disponibles para ${or.name} el ${formatFechaES(parsedISO)}�\n\n` +
        `Tengo estos espacios:\n\n${lista}\n\n` +
        `Por favor, elija el n�mero del horario que m�s le convenga.`
      );
      return res.type('text/xml').send(msg.toString());
    }

    if (state.step === 'SLOT') {
      const payload = state.payload;
      const slots = payload.slots;

      if (body.toLowerCase() === 'ver') {
        const lista = slots.slice(0, 10).map((s, i) => `${i + 1}?? ${s.label}`).join('\n');
        msg.message('?? Horarios disponibles:\n\n' + lista + '\n\nElija el n�mero.');
        return res.type('text/xml').send(msg.toString());
      }

      const n = parseInt(body.trim(), 10);
      if (!Number.isInteger(n) || n < 1 || n > slots.length) {
        msg.message('? Opci�n inv�lida.\n\nEscriba un n�mero v�lido de la lista.');
        return res.type('text/xml').send(msg.toString());
      }

      const chosen = slots[n - 1];
      const r = await createReservation({
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
          msg.message('? Ese horario se acaba de ocupar y ya no hay m�s disponibles ese d�a.\n\n�Puedo ayudarle con otra fecha?');
          return res.type('text/xml').send(msg.toString());
        }
        setSession(from, { step: 'SLOT', doctor: state.doctor, payload: { ...payload, slots: slots2 } });
        const lista2 = slots2.slice(0, 10).map((s, i) => `${i + 1}?? ${s.label}`).join('\n');
        msg.message('?? Ese horario se ocup� justo ahora.\n\n?? Opciones disponibles:\n\n' + lista2 + '\n\nElija el n�mero.');
        return res.type('text/xml').send(msg.toString());
      }

      msg.message(
        `Perfecto ?\n` +
        `Su reserva ha sido creada con �xito:\n\n` +
        `Doctor: ${state.doctor.name}\n` +
        `Procedimiento: ${payload.procedure.name}\n` +
        `Quir�fano: ${payload.or.name}\n` +
        `Fecha: ${formatFechaES(payload.dateISO)}\n` +
        `Hora: ${chosen.label}\n` +
        `Folio: ${r.id}\n\n` +
        `?? Ya que conoce los pasos, la pr�xima vez puede solicitar una reserva en una sola oraci�n.\n\n` +
        `Por ejemplo:\n` +
        `"Quiero agendar una colecistectom�a para el 24 de octubre".\n\n` +
        `As� podr� procesarlo autom�ticamente para agilizar su solicitud.\n\n` +
        `�Puedo ayudarle con algo m�s hoy?`
      );
      clearSession(from);
      return res.type('text/xml').send(msg.toString());
    }

    if (state.step === 'CANCEL_SELECT') {
      const payload = state.payload || {};
      const list = Array.isArray(payload.list) ? payload.list : [];
      if (body.toLowerCase() === 'salir') {
        clearSession(from);
        msg.message('Operaci�n cancelada.\n\n�Puedo ayudarle con algo m�s hoy?');
        return res.type('text/xml').send(msg.toString());
      }
      const n = parseInt(body.trim(), 10);
      if (!Number.isInteger(n) || n < 1 || n > list.length) {
        msg.message(`? Opci�n inv�lida.\n\nEscriba un n�mero (1-${list.length}) o "salir".`);
        return res.type('text/xml').send(msg.toString());
      }
      const chosen = list[n - 1];
      try {
        const { cancelReservation } = require('../data/storage');
        await cancelReservation(chosen.id);
        clearSession(from);
        msg.message(
          `Entendido, su reserva Folio ${chosen.id} fue cancelada correctamente.\n\n` +
          `�Desea crear una nueva o ver sus pr�ximas reservas?`
        );
      } catch (e) {
        console.error('Cancel error:', e);
        clearSession(from);
        msg.message('?? No pude cancelar en este momento. Intente de nuevo.\n\n�Puedo ayudarle con algo m�s hoy?');
      }
      return res.type('text/xml').send(msg.toString());
    }

    msg.message('No le entend�. Escriba "reset" para volver al men�.\n\n�Puedo ayudarle con algo m�s hoy?');
    return res.type('text/xml').send(msg.toString());

  } catch (error) {
    console.error('? Error en /whatsapp:', error);
    try {
      msg.message('?? Hubo un error procesando su solicitud. Por favor escriba "reset" para reiniciar.');
      return res.type('text/xml').send(msg.toString());
    } catch {
      return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
  }
}

module.exports = { whatsappHandler };
