/**
 * Adaptador para el sistema de cache
 */
const NodeCache = require('node-cache');
const logger = require('../utils/logger');
const config = require('../config').cache;

// Instancia de cache
const chace = new NodeCache({
  stdTTL: config.ttl, // Tiempo de vida predeterminada en segundos
  checkperiod: 120, // Periodo de comprobacion para expiracion en segundos
  useClones: false, // Para objetos grandes, evitar clonacion
})

/**
 * Obtiene un elemento de la cache
 * @param {string} key - Clave de la cache
 * @returns {Promise<any>} - Valor almacenado en la cache o null
 */
async function get(key) {
  try {
    const value = cache.get(key);

    if (value === undefined) {
      logger.debug(`Cache miss`);
      return null;
    }

    logger.debug({ key }, 'Cache hit')
    return value;
  } catch (error) {
    logger.error({ err: error, key }, 'Error al obtener de la cache');
    return null;
  }
}

/**
 * Establece un elemento en la cache
 * @param {string} key - Clave de la cache
 * @param {any} value - Valor a almacenar
 * @param {number} ttl - Tiempo de vida en segundos (opcional)
 * @returns {Promise<boolean>} True si se almacena correctamente, false en caso contrario
 */
async function set(key, value, ttl = config.ttl) {
  try {
    const success = cache.set(key, value, ttl);

    if (success) {
      logger.debug({ key, ttl }, 'Valor almacenado en cache')
    } else {
      logger.warn({ key }, 'No se pudo almacenar valor en cache')
    }

    return success
  } catch (error) {
    logger.error({ err: error, key }, 'Error al almacenar en la cache');
    return false;
  }
}

/**
 * Elimina un elemento de la cache
 * @param {string} key - Clave de la cache
 * @returns {Promise<number>} Numero de elementos eliminados
 */
async function del(key) {
  try {
    // Si la clave contiene un asterisco, eliminar por patron
    if (key.includes('*')) {
      const pattern = new RegExp(key.replace(/\*/g, '.*'));
      const keys = cache.keys().filter(k => pattern.test(k));

      if (keys.length === 0) {
        return 0;
      }

      let count = 0;
      for (const k of keys) {
        const success = cache.del(k);
        if (success) count++;
      }

      logger.debug({ pattern: key, count }, 'Elementos eliminados')
      return count;
    } else {
      // Eliminar una clave especifica
      const success = cache.del(key);

      if (success) {
        logger.debug({ key }, 'Elemento eliminado de la cache')
        return 1;
      } else {
        logger.debig({ key }, 'No se encontro el elemento en la cache')
        return 0;
      }
    }
  } catch (error) {
    logger.error({ err: error, key }, 'Error al eliminar de la cache');
    return 0;
  }
}

/**
 * Limpia toda la cache
 * @returns {Promise<void>}
 */
async function flush() {
  try {
    cache.flushAll();
    logger.info('Cache limpiada completamente')
  } catch (error) {
    logger.error({ err: error }, 'Error al limpiar la cache');
    throw error
  }
}

/**
 * Obtiene estadisticas de la cache
 * @returns {Promise<Object>} - Estadisticas de la cache
 */
async function getStats() {
  try {
    return cache.getStats();
  } catch (error) {
    logger.error({ err: error }, 'Error al obtener estadisticas de la cache');
    throw error
  }
}

module.exports = {
  get,
  set,
  del,
  flush,
  getStats,
}