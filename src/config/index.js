/**
 * Configuracion centralizada de la aplicacion
 */
const telegramConfig = require('./telegram');
const jiraConfig = require('./jira');
const databaseConfig = require('./database');
const webhookConfig = require('./webhook');
const cacheConfig = require('./cache');
const notificationConfig = require('./notification');

module.exports = {
  telegram: telegramConfig,
  jira: jiraConfig,
  database: databaseConfig,
  webhook: webhookConfig,
  cache: cacheConfig,
  notification: notificationConfig,
  app: {
    environment: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
    tempDir: process.env.TEMP_DIR || './temp',
    maxImagesPerTicket: parseInt(process.env.MAX_IMAGES_PER_TICKET || '5', 10),
  }
}