/**
 * index.js
 * Punto de entrada principal de la aplicación
 */

require('dotenv').config();
const express = require('express');
const { setupRoutes } = require('./routes');
const { PORT } = require('./config');

// Crear aplicación Express
const app = express();

// Configurar rutas
setupRoutes(app);

// Levantar servidor
app.listen(PORT, () => {
  console.log('✅ Servidor listo: http://localhost:' + PORT);
  console.log('📍 Webhook WhatsApp: http://localhost:' + PORT + '/whatsapp');
  console.log('🌐 Para Twilio, usa tu URL de ngrok + /whatsapp');
});