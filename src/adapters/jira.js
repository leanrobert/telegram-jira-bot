/**
 * Adaptador para la API de JIRA
 */
const JiraApi = require('jira-client');
const fs = require('fs');
const logger = require('../utils/logger');
const cacheAdapter = require('./cache');
const config = require('../config').jira;

let jiraClient;

/**
 * Inicializar cliente de JIRA
 */
async function init() {
  try {
    jiraClient = new JiraApi({
      protocol: 'https',
      host: config.host,
      username: config.username,
      password: config.password,
      apiVersion: '2',
      strictSSL: true
    })

    // Verificar conexion con solicitud sencilla
    await jiraClient.getCurrentUser();
    logger.info('Conexion a JIRA establecida correctamente');

    return jiraClient;
  } catch (error) {
    logger.error({ err: error }, 'Error inicializando el cliente de JIRA')
    throw error;
  }
}

/**
 * Obtiene el cliente de JIRA
 * @returns {JiraApi} Cliente de JIRA
 */
function getClient() {
  if (!jiraClient) {
    throw new Error('El cliente de JIRA no ha sido inicializado');
  }
  return jiraClient;
}

/**
 * Busca tickets en JIRA
 * @param {string} query - Consulta JQL para buscar tickets
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<Object>} - Resultado de la búsqueda
 */
async function searchTickets(query, options = { maxResults: 10 }) {
  const cacheKey = `jira:search:${query}:${JSON.stringify(options)}`;

  try {
    // Intentar obtener resultados desde cache
    const cacheResult = await cacheAdapter.get(cacheKey);

    if (cacheResult) {
      logger.debug({ query }, 'Resultados obtenidos desde cache');
      return cacheResult;
    }

    // Ejecutar busqueda en JIRA
    const result = await jiraClient.searchJira(query, options);

    // Guardar busqueda en cache
    await cacheAdapter.set(cacheKey, result, config.cacheTTL);

    return result;
  } catch (error) {
    logger.error({ err: error, query }, 'Error buscando tickets en JIRA');
    throw error;
  }
}

/**
 * Obtiene detalles de un ticket
 * @param {string} ticketKey - Clave del ticket (ej. "PRJS-500")
 * @returns {Promise<Object>} - Detalles del ticket
 */
async function getTicketDetails(ticketKey) {
  const cacheKey = `jira:ticket:${ticketKey}`;

  try {
    // Intentar obtener desde cache
    const cachedTicket = await cacheAdapter.get(cacheKey);

    if (cachedTicket) {
      logger.debug({ ticketKey }, 'Detalles obtenidos desde cache');
      return cachedTicket;
    }

    // Obtener desde JIRA
    const ticket = await jiraClient.findIssue(ticketKey);

    // Guardar en cache
    await cacheAdapter.set(cacheKey, ticket, config.cacheTTL);

    return ticket;
  } catch (error) {
    logger.error({ err: error, ticketKey }, 'Error obteniendo detalles del ticket');
    throw error;
  }
}

/**
 * Crea un nuevo ticket en JIRA
 * @param {Object} ticketData - Datos del ticket a crear
 * @param {Object} telegramInfo - Información del usuario de Telegram
 * @returns {Promise<Object>} - Ticket creado
 */
async function createTicket(ticketData, telegramInfo) {
  try {
    const { summary, description, category = 'Incidencia', priority = 'Normal' } = ticketData;

    const issueData = {
      fields: {
        project: {
          key: config.projectKey
        },
        summary,
        description,
        issuetype: {
          name: category
        },
        priority: {
          name: priority
        },
        [config.customFields.telegramUsername]: telegramInfo.username || '',
        [config.customFields.telegramName]: telegramInfo.name || '',
      }
    }

    const createdIssue = await jiraClient.addNewIssue(issueData);
    logger.info({ ticketKey: createdIssue.key }, 'Ticket creado en JIRA');

    // Invalidar cache relacionada
    await cacheAdapter.del('jira:search:*');

    return createdIssue;
  } catch (error) {
    logger.error({ err: error }, 'Error creando ticket en JIRA');
    throw error;
  }
}

/**
 * Añade un comentario a un ticket
 * @param {string} ticketKey - Clave del ticket
 * @param {string} comment - Texto del comentario
 * @param {Object} author - Información del autor
 * @returns {Promise<Object>} Comentario creado
 */
async function addComment(ticketKey, comment, author) {
  try {
    // Preparar texto del comentario con información del autor de Telegram
    const commentBody = author ?
      `*Comentario desde Telegram*\nUsuario: ${author.name} ${author.username ? `(@${author.username})` : ''}\n\n${comment}` :
      comment;

    const result = await jiraClient.addComment(ticketKey, commentBody);
    logger.info({ ticketKey }, 'Comentario añadido al ticket');

    // Invalidar caché del ticket
    await cacheAdapter.del(`jira:ticket:${ticketKey}`);
    await cacheAdapter.del(`jira:comments:${ticketKey}`);

    return result;
  } catch (error) {
    logger.error({ err: error, ticketKey }, 'Error añadiendo comentario');
    throw error;
  }
}

/**
 * Obtiene comentarios de un ticket
 * @param {string} ticketKey - Clave del ticket
 * @returns {Promise<Array>} Lista de comentarios
 */
async function getComments(ticketKey) {
  const cacheKey = `jira:comments:${ticketKey}`;

  try {
    // Intentar obtener desde caché
    const cachedComments = await cacheAdapter.get(cacheKey);
    if (cachedComments) {
      logger.debug({ ticketKey }, 'Comentarios recuperados de caché');
      return cachedComments;
    }

    // Obtener de JIRA
    const comments = await jiraClient.getIssueComments(ticketKey);

    // Guardar en caché
    await cacheAdapter.set(cacheKey, comments, config.cacheTTL);

    return comments;
  } catch (error) {
    logger.error({ err: error, ticketKey }, 'Error obteniendo comentarios del ticket');
    throw error;
  }
}

/**
 * Añade un archivo adjunto a un ticket
 * @param {string} ticketKey - Clave del ticket
 * @param {string} filePath - Ruta del archivo
 * @returns {Promise<Object>} Resultado de la operación
 */
async function addAttachment(ticketKey, filePath) {
  try {
    const result = await jiraClient.addAttachmentOnIssue(
      ticketKey,
      fs.createReadStream(filePath)
    );

    logger.info({ ticketKey, fileName: filePath }, 'Archivo adjunto añadido al ticket');

    // Invalidar caché del ticket
    await cacheAdapter.del(`jira:ticket:${ticketKey}`);

    return result;
  } catch (error) {
    logger.error({ err: error, ticketKey, filePath }, 'Error añadiendo archivo adjunto');
    throw error;
  }
}

/**
 * Busca tickets por usuario de Telegram
 * @param {string} username - Nombre de usuario de Telegram
 * @param {string} fullName - Nombre completo del usuario
 * @returns {Promise<Array>} Lista de tickets
 */
async function searchTicketsByUser(username, fullName) {
  try {
    let jqlQuery;

    if (username) {
      jqlQuery = `${config.customFields.telegramUsername} ~ "${username}" ORDER BY created DESC`;
    } else if (fullName) {
      jqlQuery = `${config.customFields.telegramName} ~ "${fullName}" ORDER BY created DESC`;
    } else {
      throw new Error('Se requiere username o fullName para buscar tickets');
    }

    return await searchTickets(jqlQuery, { maxResults: 20 });
  } catch (error) {
    logger.error({ err: error, username, fullName }, 'Error buscando tickets por usuario');
    throw error;
  }
}

module.exports = {
  initialize,
  getClient,
  searchTickets,
  getTicketDetails,
  createTicket,
  addComment,
  getComments,
  addAttachment,
  searchTicketsByUser
};