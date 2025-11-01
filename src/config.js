// Config global + instancia de dayjs lista (evita "dayjs is not a function")
const dayjsLib = require('dayjs');
const utc = require('dayjs/plugin/utc');
const tz = require('dayjs/plugin/timezone');
const customParseFormat = require('dayjs/plugin/customParseFormat');
require('dayjs/locale/es');

dayjsLib.extend(utc);
dayjsLib.extend(tz);
dayjsLib.extend(customParseFormat);
dayjsLib.locale('es');

// Timezone / año actual / caché
const TIMEZONE = 'America/Mexico_City';
const CURRENT_YEAR = 2025;
const CACHE_TTL = 30000; // 30s

// URLs: usa .env si existe; si no, usa las del script funcional
const SHEET_URLS = {
  doctores:      process.env.SHEET_DOCTORES_URL || 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQm8oAhj9HW8nWE7QY6BjWwEJkCEPuK5EawbyvlMm_v6SDNNwKM0ycdkc5qz2TFCjNN6Xrxo2l3atBA/pubhtml?gid=502193309&single=true',
  quirofanos:    process.env.SHEET_QUIROFANOS_URL || 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQm8oAhj9HW8nWE7QY6BjWwEJkCEPuK5EawbyvlMm_v6SDNNwKM0ycdkc5qz2TFCjNN6Xrxo2l3atBA/pubhtml?gid=1055760109&single=true',
  procedimientos:process.env.SHEET_PROCEDIMIENTOS_URL || 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQm8oAhj9HW8nWE7QY6BjWwEJkCEPuK5EawbyvlMm_v6SDNNwKM0ycdkc5qz2TFCjNN6Xrxo2l3atBA/pubhtml?gid=1429038100&single=true',
  reservas:      process.env.SHEET_RESERVAS_URL || 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQm8oAhj9HW8nWE7QY6BjWwEJkCEPuK5EawbyvlMm_v6SDNNwKM0ycdkc5qz2TFCjNN6Xrxo2l3atBA/pubhtml?gid=0&single=true',
};

const GAS_ENDPOINT = process.env.GAS_ENDPOINT || 'https://script.google.com/macros/s/AKfycbzlL2_aLHuArPDqzn2TPXjeSMCQoSjmO2jWVSu-VCD9WQIBaurxfsXjv1Up2IFGnVPU/exec';

module.exports = {
  dayjs: dayjsLib,
  TIMEZONE,
  CURRENT_YEAR,
  CACHE_TTL,
  SHEET_URLS,
  GAS_ENDPOINT,
};
