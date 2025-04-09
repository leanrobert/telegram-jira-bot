/**
 * Punto de entrada principal para el bot de Telegram-JIRA
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const logger = require('./utils/logger');
const telegramAdapter = require('./adapters/telegram');
const jiraAdapter = require('./adapters/jira');
const databaseAdapter = require('./adapters/database');
const webhookServer = require('./webhooks');
const notificationService = require('./core/services/notification');

/**
 * Manejo de errores no capturados
 */
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught Exception');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.fatal({ reason, promise }, 'Unhandled Rejection');
  process.exit(1);
});

/**
 * Inicializacion de la aplicacion
 */
async function bootstrap() {
  try {
    logger.info('Iniciando aplicacion...');

    // Inicializar conexion a la base de datos
    await databaseAdapter.connect();
    logger.info('Conexion a la base de datos establecida');

    // Inicializar el adaptador de JIRA
    await jiraAdapter.init();
    logger.info('Adaptador de JIRA inicializado');

    // Inicializar el adaptador de Telegram
    await telegramAdapter.init();
    logger.info('Bot de Telegram inicializado');

    // Inicializar servidor de webhooks para notificaciones de JIRA
    const port = process.env.PORT || 3000;
    await webhookServer.start(port);
    logger.info(`Servidor de webhooks iniciado en el puerto ${port}`);

    // Inicializar el servicio de notificaciones
    await notificationService.init();
    logger.info('Servicio de notificaciones inicializado');

    logger.info('Aplicacion iniciada correctamente');
  } catch (error) {
    logger.fatal({ err: error }, 'Error al iniciar la aplicacion');
    process.exit(1);
  }
}

bootstrap();