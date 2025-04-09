/**
 * Adaptador para la API de Telegram
 */
const TelegramBot = require("node-telegram-bot-api");
const path = require("path");
const fs = require("fs");
const logger = require("../utils/logger");
const commandRouter = require("../core/commands");
const config = require('../config').telegram;

let bot;
const TEMP_DIR = path.join(__dirname, "../../temp");

// Asegurar que exista el directorio temporal
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

/**
 * Inicializa el bot de Telegram
 */
async function init() {
  try {
    bot = new TelegramBot(config.token, { polling: true });
    logger.info('Bot de Telegram inicializado');

    // Registrar manejadores de eventos
    registerEventHandlers();

    return bot;
  } catch (error) {
    logger.error({ err: error }, 'Error inicializando el bot de telegram');
    throw error;
  }
}

/**
 * Registrar manejadores de eventos del bot
 */
function registerEventHandlers() {
  // Manejar cambios
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;

    try {
      await commandRouter.handleCommand('start', msg, bot);
    } catch (error) {
      logger.error({ err: error, chatId }, 'Error manejando el comando /start');
      sendErrorMessage(chatId, 'Error al procesar el comando. Intente nuevamente.');
    }
  });

  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;

    try {
      await commandRouter.handleCommand('help', msg, bot);
    } catch (error) {
      logger.error({ err: error, chatId }, 'Error manejando el comando /help');
      sendErrorMessage(chatId, 'Error al procesar el comando. Intente nuevamente.');
    }
  });

  bot.onText(/\/cancel/, async (msg) => {
    const chatId = msg.chat.id;

    try {
      await commandRouter.handleCommand('cancel', msg, bot);
    } catch (error) {
      logger.error({ err: error, chatId }, 'Error manejando el comando /cancel');
      sendErrorMessage(chatId, 'Error al procesar el comando. Intente nuevamente.');
    }
  });

  bot.on('callback_query', async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;

    try {
      await bot.answerCallbackQuery(callbackQuery.id);
      await commandRouter.handleCallback(callbackQuery, bot);
    } catch (error) {
      logger.error({ err: error, chatId, callbackData: callbackQuery.data }, 'Error manejando la callback query');
      sendErrorMessage(chatId, 'Error al procesar la consulta. Intente nuevamente.');
    }
  })

  bot.on('message', async (msg) => {
    // Ignorar comandos y mensajes sin text
    if (!msg.txt || msg.text.startsWith('/')) return;

    const chatId = msg.chat.id;

    try {
      await commandRouter.handleMessage(msg, bot);
    } catch (error) {
      logger.error({ err: error, chatId }, 'Error manejando el mensaje de texto');
      sendErrorMessage(chatId, 'Error al procesar el mensaje. Intente nuevamente.');
    }
  })

  bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;

    try {
      await commandRouter.handlePhoto(msg, bot);
    } catch (error) {
      logger.error({ err: error, chatId }, 'Error manejando la foto');
      sendErrorMessage(chatId, 'Error al procesar la foto. Intente nuevamente.');
    }
  });

  bot.on('polling_error', (error) => {
    logger.error({ err: error }, 'Error en el polling del bot de telegram');
  });

  logger.info('Manejadores de eventos de Telegram registrados')
}

/**
 * Envia un mensaje de error al usuario
 * @param {number} chatId - ID del chat
 * @param {string} message - Mensaje de error
 */
async function sendErrorMessage(chatId, message) {
  try {
    await bot.sendMessage(chatId, `❌ ${message}`);
  } catch (error) {
    logger.error({ err: error, chatId }, 'Error enviando mensaje de error al usuario');
  }
}

/**
 * Obtiene el bot de Telegram
 * @returns {TelegramBot} Instancia del bot
 */
function getBot() {
  if (!bot) {
    throw new Error('El bot de Telegram no ha sido inicializado');
  }

  return bot;
}

/**
 * Envia un mensaje a un chat especifico
 * @param {number} chatId - ID del chat
 * @param {string} text - Mensaje a enviar
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<Message>} - Mensaje enviado
 */
async function sendMessage(chatId, text, options = {}) {
  try {
    return await bot.sendMessage(chatId, text, options);
  } catch (error) {
    logger.error({ err: error, chatId }, 'Error enviando mensaje al chat');
    throw error;
  }
}

/**
 * Edita un mensaje existente
 * @param {string} text - Nuevo texto
 * @param {Object} options - Opciones de edicion
 * @returns {Promise<Message>} - Mensaje editado
 */
async function editMessage(text, options) {
  try {
    return await bot.editMessageText(text, options);
  } catch (error) {
    logger.error({ err: error }, 'Error editando mensaje');
    throw error;
  }
}

/**
 * Descarga un archivo de Telegram
 * @param {string} fileId - ID del archivo
 * @returns {Promise<string>} - Ruta del archivo descargado
 */
async function downloadFile(fileId) {
  try {
    const fileInfo = await bot.getFile(fileId);
    const filePath = fileInfo.file_path;

    const fileName = `${Date.now()}_${path.basename(filePath)}`;
    const localFilePath = path.join(TEMP_DIR, fileName);

    const fileStream = await bot.downloadFile(fileId, TEMP_DIR);

    return localFilePath;
  } catch (error) {
    logger.error({ err: error, fileId }, 'Error descargando el archivo de Telegram');
    throw error;
  }
}

module.exports = {
  init,
  getBot,
  sendMessage,
  editMessage,
  downloadFile
}