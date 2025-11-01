require('dotenv').config();
const express = require('express');
const { whatsappHandler } = require('./handlers/whatsapp');

const app = express();

// Twilio envía x-www-form-urlencoded
app.use(express.urlencoded({ extended: false }));

// Fuerza UTF-8 para mensajes
app.use((req, res, next) => {
  res.set('Content-Type', 'text/xml; charset=utf-8');
  next();
});

app.get('/', (_req, res) => res.send('Bot de Reservas Quirófano - Activo ✅'));
app.post('/whatsapp', whatsappHandler);

// Error global
app.use((err, req, res, next) => {
  console.error('❌ Error no capturado:', err);
  res.status(500).send('Error interno del servidor');
});

app.listen(3000, () => console.log('✅ Servidor listo: http://localhost:3000'));
