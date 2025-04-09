/**
 * Configuracion del bot de telegram
 */
module.exports = {
  token: process.env.TELEGRAM_TOKEN,

  // Tiempos de espera para operaciones
  timeouts: {
    messageEdit: 1000, // Tiempo minimo entre ediciones de mensajes
    messageDelete: 5000, // Tiempo de espera antes de eliminar un mensaje
    userInactivity: 300000, // Tiempo de inactividad para limpiar estados de usuario (5min)
  },

  // Limites
  limits: {
    maxTextLength: 4096,
    maxCaptionLength: 1024,
    maxButtonsPerRow: 3,
    maxInlineKeyboardRows: 10,
  },

  // Plantillas de mensajes
  messages: {
    welcome: '-----------------------------------------------\n*👋 Bienvenido al Bot de tickets de Jira!*\n\n¿Qué te gustaría hacer?\n-----------------------------------------------',
    ticketCreated: '✅ Ticket creado correctamente!\n\nID: {ticketKey}\nURL: {ticketUrl}',
    error: '❌ {message}',
    cancelled: 'Operación cancelada.',
  }
}