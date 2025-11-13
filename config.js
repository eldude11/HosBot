/**
 * config.js
 * Configuración central de la aplicación
 */

module.exports = {
  // Zona horaria
  TIMEZONE: 'America/Mexico_City',
  CURRENT_YEAR: 2025,
  
  // Caché (30 segundos)
  CACHE_TTL: 30000,
  
  // Buffer entre citas (minutos)
  BUFFER_MIN: 10,
  
  // URLs de Google Sheets (pubhtml)
  SHEET_URLS: {
    doctores: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQm8oAhj9HW8nWE7QY6BjWwEJkCEPuK5EawbyvlMm_v6SDNNwKM0ycdkc5qz2TFCjNN6Xrxo2l3atBA/pubhtml?gid=502193309&single=true',
    quirofanos: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQm8oAhj9HW8nWE7QY6BjWwEJkCEPuK5EawbyvlMm_v6SDNNwKM0ycdkc5qz2TFCjNN6Xrxo2l3atBA/pubhtml?gid=1055760109&single=true',
    procedimientos: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQm8oAhj9HW8nWE7QY6BjWwEJkCEPuK5EawbyvlMm_v6SDNNwKM0ycdkc5qz2TFCjNN6Xrxo2l3atBA/pubhtml?gid=1429038100&single=true',
    reservas: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQm8oAhj9HW8nWE7QY6BjWwEJkCEPuK5EawbyvlMm_v6SDNNwKM0ycdkc5qz2TFCjNN6Xrxo2l3atBA/pubhtml?gid=0&single=true'
  },
  
  // Google Apps Script endpoint
  GAS_ENDPOINT: 'https://script.google.com/macros/s/AKfycbzlL2_aLHuArPDqzn2TPXjeSMCQoSjmO2jWVSu-VCD9WQIBaurxfsXjv1Up2IFGnVPU/exec',
  
  // Archivo local de respaldo
  LOCAL_STORAGE_FILE: './reservas.json',
  
  // Puerto del servidor
  PORT: process.env.PORT || 3000
};