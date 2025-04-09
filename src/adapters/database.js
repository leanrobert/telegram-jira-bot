/**
 * Adaptador para la base de datos MongoDB
 */
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const config = require('../config').database;

let isConnected = false;

/**
 * Conecta con la base de datos MongoDB
 */
async function connect() {
  if (isConnected) {
    logger.debug('Utilizando conexion existente a MongoDB');
    return;
  }

  try {
    // Configurar opciones de conexion
    mongoose.set('strictQuery', false);

    // Conectar a MongoDB
    await mongoose.connect(config.uri, {
      socketTimeoutMS: 30000,
      connectTimeoutMS: 30000,
    });

    isConnected = true;
    logger.info('Conexion exitosa a MongoDB');

    // Escuchar eventos de conexion
    mongoose.connection.on('error', (err) => {
      logger.error({ err }, 'Error de conexion a MongoDB');
      isConnected = false;
    })

    mongoose.connection.on('disconnected', () => {
      logger.warn('Desconectado de MongoDB');
      isConnected = false;
    });

    return mongoose.connection;
  } catch (error) {
    logger.error({ err: error }, 'Error al conectar a MongoDB');
    isConnected = false;
    throw error;
  }
}

/**
 * Cierra la conexion con MongoDB
 */
async function disconnect() {
  if (!isConnected) {
    return;
  }

  try {
    await mongoose.disconnect();
    isConnected = false;
    logger.info('Desconexion exitosa de MongoDB');
  } catch (error) {
    logger.error({ err: error }, 'Error al desconectar de MongoDB');
    throw error;
  }
}

/**
 * Verifica el estado de la conexion
 * @returns {boolean} Estado de la conexion
 */
function isConnectedToDB() {
  return isConnected && mongoose.connection.readyState === 1;
}

/**
 * Obtiene la instancia de conexion de mongoose
 * @returns {mongoose.Connection} Instancia de conexion de mongoose
 */
function getConnection() {
  if (!isConnected) {
    throw new Error('No hay conexion activa a MongoDB');
  }

  return mongoose.connection;
}

module.exports = {
  connect,
  disconnect,
  isConnectedToDB,
  getConnection
}