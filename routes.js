/**
 * routes.js
 * Definición de todas las rutas de la aplicación
 */

const express = require('express');
const { handleWhatsApp } = require('./handlers/whatsapp');

function setupRoutes(app) {
  // Middleware para parsear body de Twilio
  app.use(express.urlencoded({ extended: false }));
  
  // Ruta raíz - Health check
  app.get('/', (req, res) => {
    res.send('Bot de Reservas Quirófano - Activo ✅');
  });
  
  // Webhook de WhatsApp
  app.post('/whatsapp', handleWhatsApp);
  
  // Middleware de error global
  app.use((err, req, res, next) => {
    console.error('❌ Error no capturado:', err);
    res.status(500).send('Error interno del servidor');
  });
}

module.exports = { setupRoutes };