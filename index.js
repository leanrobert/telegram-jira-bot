const TelegramBot = require("node-telegram-bot-api");
const JiraApi = require("jira-client");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const Database = require("./database");

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  console.error("Stack:", error.stack);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

dotenv.config();

const jira = new JiraApi({
  protocol: "https",
  host: process.env.JIRA_HOST,
  username: process.env.JIRA_USERNAME,
  password: process.env.JIRA_API_TOKEN,
  apiVersion: "2",
  strictSSL: true,
});

const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Initialize database
const db = new Database();

const userStates = {};
const userNotifications = {}; // Store user notification preferences (will be migrated to DB)
const TEMP_DIR = path.join(__dirname, "temp");
const MAX_IMAGES = 5;
const NOTIFICATION_CHECK_INTERVAL = 60 * 1000; // Check every 60 seconds

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR);
}

const ticketFields = [
  { field: "category", question: "1️⃣ Seleccione la categoría del ticket:" },
  { field: "summary", question: "2️⃣ Ingrese el titulo del ticket:" },
  { field: "description", question: "3️⃣ Ingrese la descripción del ticket:" },
  { field: "images", question: "4️⃣ Adjunte imágenes (máximo 5, opcional):" },
];

const ticketCategories = [
  {
    name: "Urgencia",
    emoji: "🚨",
    issueType: "Incidencia de Telegram",
    dueDays: 1, // Due date: 1 day from creation
  },
  {
    name: "Mejora",
    emoji: "✨",
    issueType: "Incidencia de Telegram",
    dueDays: 7, // Due date: 7 days from creation
  },
  {
    name: "Error",
    emoji: "🐛",
    issueType: "Incidencia de Telegram",
    dueDays: 3, // Due date: 3 days from creation
  },
];

function logError(error) {
  console.error("Error:", error);
  console.error("Stack:", error.stack);
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  sendMainMenu(chatId);
});

function sendMainMenu(chatId) {
  // Check if notifications are enabled from database (async, but we'll use in-memory as fallback)
  const isNotificationsEnabled = userNotifications[chatId]?.enabled || false;

  const mainMenuKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Crear ticket", callback_data: "create_ticket" },
          { text: "Ver mis tickets", callback_data: "list_tickets" },
        ],
        [
          {
            text: isNotificationsEnabled
              ? "🔕 Desactivar notificaciones"
              : "🔔 Activar notificaciones",
            callback_data: isNotificationsEnabled
              ? "disable_notifications"
              : "enable_notifications",
          },
        ],
      ],
    },
    parse_mode: "Markdown",
  };

  bot
    .sendMessage(
      chatId,
      "*👋 Bienvenido al Bot de tickets de Jira!*\n\nQue te gustaria hacer?\n",
      mainMenuKeyboard
    )
    .catch(logError);
}

bot.on("callback_query", async (callbackQuery) => {
  const chatId = callbackQuery.message.chat.id;
  const action = callbackQuery.data;

  bot.answerCallbackQuery(callbackQuery.id);

  if (action === "create_ticket") {
    const userId = callbackQuery.from.id;
    const firstName = callbackQuery.from.first_name || "";
    const lastName = callbackQuery.from.last_name || "";
    const username = callbackQuery.from.username || "";

    userStates[chatId] = {
      creating: true,
      currentField: 0,
      ticketData: {},
      telegramInfo: {
        userId: userId,
        name: `${firstName} ${lastName}`.trim(),
        username: username,
      },
    };

    // Show category selection
    const categoryKeyboard = {
      inline_keyboard: [
        ...ticketCategories.map((category) => [
          {
            text: `${category.name}`,
            callback_data: `select_category_${category.name.toLowerCase()}`,
          },
        ]),
        [{ text: "Cancelar", callback_data: "cancel_creation" }],
      ],
    };

    bot.sendMessage(chatId, ticketFields[0].question, {
      parse_mode: "Markdown",
      reply_markup: categoryKeyboard,
    });
  } else if (action.startsWith("select_category_")) {
    const categoryName = action.replace("select_category_", "");
    const category = ticketCategories.find(
      (cat) => cat.name.toLowerCase() === categoryName
    );

    if (userStates[chatId] && userStates[chatId].creating && category) {
      const state = userStates[chatId];
      state.ticketData.category = category;
      state.currentField++; // Move to next field (title)

      const cancelKeyboard = {
        inline_keyboard: [
          [{ text: "Cancelar", callback_data: "cancel_creation" }],
        ],
      };

      bot.sendMessage(
        chatId,
        `Categoría seleccionada: *${category.name}*\n\n${
          ticketFields[state.currentField].question
        }`,
        {
          parse_mode: "Markdown",
          reply_markup: cancelKeyboard,
        }
      );
    }
  } else if (action === "enable_notifications") {
    const userId = callbackQuery.from.id;
    const firstName = callbackQuery.from.first_name || "";
    const lastName = callbackQuery.from.last_name || "";
    const username = callbackQuery.from.username || "";

    const telegramInfo = {
      userId: userId,
      name: `${firstName} ${lastName}`.trim(),
      username: username,
    };

    await enableNotifications(chatId, telegramInfo);
    setTimeout(() => sendMainMenu(chatId), 2000);
  } else if (action === "disable_notifications") {
    await disableNotifications(chatId);
    setTimeout(() => sendMainMenu(chatId), 2000);
  } else if (action === "list_tickets") {
    const username = callbackQuery.from.username || "";
    const firstName = callbackQuery.from.first_name || "";
    const lastName = callbackQuery.from.last_name || "";
    const fullName = `${firstName} ${lastName}`.trim();

    try {
      await listUserTickets(chatId, username, fullName);
    } catch (error) {
      bot.sendMessage(chatId, `Error listando tickets: ${error.message}`);
      sendMainMenu(chatId);
    }
  } else if (action === "cancel_creation") {
    delete userStates[chatId];
    bot.sendMessage(chatId, "Creación de ticket cancelada.");
    sendMainMenu(chatId);
  } else if (action === "finish_images") {
    if (userStates[chatId] && userStates[chatId].creating) {
      const state = userStates[chatId];

      if (ticketFields[state.currentField].field === "images") {
        // Move to the next step - which is creating the ticket
        state.currentField++;

        bot.sendMessage(
          chatId,
          `Imágenes guardadas: ${
            state.ticketData.images ? state.ticketData.images.length : 0
          }. Continuando con la creación del ticket...`
        );

        if (state.currentField >= ticketFields.length) {
          try {
            await createJiraTicket(
              chatId,
              state.ticketData,
              state.telegramInfo
            );
          } catch (error) {
            bot.sendMessage(
              chatId,
              `Error creando el ticket: ${error.message}`
            );
          }

          delete userStates[chatId];
          setTimeout(() => sendMainMenu(chatId), 1000);
        }
      }
    }
  } else if (action === "skip_images") {
    if (userStates[chatId] && userStates[chatId].creating) {
      const state = userStates[chatId];

      if (ticketFields[state.currentField].field === "images") {
        // Initialize empty images array if skipping
        state.ticketData.images = [];
        state.currentField++;

        bot.sendMessage(
          chatId,
          "Imágenes omitidas. Continuando con la creación del ticket..."
        );

        if (state.currentField >= ticketFields.length) {
          try {
            await createJiraTicket(
              chatId,
              state.ticketData,
              state.telegramInfo
            );
          } catch (error) {
            bot.sendMessage(
              chatId,
              `Error creando el ticket: ${error.message}`
            );
          }

          delete userStates[chatId];
          setTimeout(() => sendMainMenu(chatId), 1000);
        }
      }
    }
  } else if (action.startsWith("view_ticket_")) {
    const ticketKey = action.replace("view_ticket_", "");

    try {
      await viewTicketDetails(chatId, ticketKey);
    } catch (error) {
      bot.sendMessage(
        chatId,
        `Error viendo detalles del ticket: ${error.message}`
      );
    }
  } else if (action.startsWith("comments_ticket_")) {
    const ticketKey = action.replace("comments_ticket_", "");

    try {
      await viewTicketComments(chatId, ticketKey);
    } catch (error) {
      bot.sendMessage(
        chatId,
        `Error viendo comentarios del ticket: ${error.message}`
      );
    }
  } else if (action === "back_to_list") {
    const username = callbackQuery.from.username || "";
    const firstName = callbackQuery.from.first_name || "";
    const lastName = callbackQuery.from.last_name || "";
    const fullName = `${firstName} ${lastName}`.trim();

    try {
      await listUserTickets(chatId, username, fullName);
    } catch (error) {
      bot.sendMessage(chatId, `Error listando tickets: ${error.message}`);
      sendMainMenu(chatId);
    }
  } else if (action === "back_to_menu") {
    sendMainMenu(chatId);
  }
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const hasPhoto = msg.photo && msg.photo.length > 0;

  if (text && text.startsWith("/")) return;

  if (userStates[chatId] && userStates[chatId].creating) {
    const state = userStates[chatId];
    const currentField = ticketFields[state.currentField];

    // Skip category field since it's handled by callback
    if (currentField.field === "category") {
      return;
    }

    // Handle image uploads
    if (currentField.field === "images") {
      if (hasPhoto) {
        // Initialize images array if it doesn't exist
        if (!state.ticketData.images) {
          state.ticketData.images = [];
          state.statusMessageId = null;
          state.lastImageTime = 0; // Track last image processing time
        }

        // Get current time to throttle UI updates
        const currentTime = Date.now();

        // Check if we've reached the maximum number of images before processing this one
        if (state.ticketData.images.length >= MAX_IMAGES) {
          // Only send limit message if we haven't already sent one recently
          // This prevents multiple messages for batch uploads
          if (!state.limitMessageId) {
            const limitMsg = await bot.sendMessage(
              chatId,
              `⚠️ Ya has alcanzado el límite máximo de ${MAX_IMAGES} imágenes.`
            );
            state.limitMessageId = limitMsg.message_id;

            // Schedule cleanup of the message ID after a delay
            setTimeout(() => {
              if (state && state.limitMessageId) {
                state.limitMessageId = null;
              }
            }, 5000); // Reset after 5 seconds
          }
          return;
        }

        // Process photo upload
        const photo = msg.photo[msg.photo.length - 1]; // Get the largest photo
        const fileId = photo.file_id;

        try {
          // Save image information
          state.ticketData.images.push({
            fileId: fileId,
            processed: false,
          });

          // Throttle UI updates to prevent excessive message edits
          // Only update status message if it's been at least 1 second since last update
          // or if we've hit the maximum images
          const shouldUpdateUI =
            currentTime - state.lastImageTime > 1000 ||
            state.ticketData.images.length >= MAX_IMAGES;

          if (shouldUpdateUI) {
            state.lastImageTime = currentTime;
            const remainingImages = MAX_IMAGES - state.ticketData.images.length;

            // Create image options keyboard
            const imageOptionsKeyboard = {
              inline_keyboard: [
                [
                  {
                    text: "✅ Finalizar y crear ticket",
                    callback_data: "finish_images",
                  },
                ],
                [
                  {
                    text: "❌ Cancelar ticket",
                    callback_data: "cancel_creation",
                  },
                ],
              ],
            };

            // Update the status message or send a new message
            const statusMessage = `📸 Imágenes: ${
              state.ticketData.images.length
            }/${MAX_IMAGES}\n${
              remainingImages > 0
                ? `\nPuedes adjuntar ${remainingImages} imagen${
                    remainingImages === 1 ? "" : "es"
                  } más, o finalizar ahora.`
                : "\n¡Has alcanzado el límite máximo de imágenes!"
            }`;

            // If we already have a status message, edit it instead of sending a new one
            if (state.statusMessageId) {
              try {
                await bot.editMessageText(statusMessage, {
                  chat_id: chatId,
                  message_id: state.statusMessageId,
                  reply_markup: imageOptionsKeyboard,
                });
              } catch (editError) {
                // If editing fails (e.g., message is too old), send a new message
                const newStatusMsg = await bot.sendMessage(
                  chatId,
                  statusMessage,
                  { reply_markup: imageOptionsKeyboard }
                );
                state.statusMessageId = newStatusMsg.message_id;
              }
            } else {
              // First image, send initial status message
              const newStatusMsg = await bot.sendMessage(
                chatId,
                statusMessage,
                { reply_markup: imageOptionsKeyboard }
              );
              state.statusMessageId = newStatusMsg.message_id;
            }
          }
        } catch (error) {
          bot.sendMessage(
            chatId,
            `Error procesando la imagen: ${error.message}`
          );
        }
      } else {
        // Display image options when user is at the image field but hasn't sent an image yet
        const imageOptionsKeyboard = {
          inline_keyboard: [
            [{ text: "⏩ Omitir imágenes", callback_data: "skip_images" }],
            [{ text: "❌ Cancelar ticket", callback_data: "cancel_creation" }],
          ],
        };

        // Only show this message on first entry to the image field or if the user sent text
        if (
          !state.ticketData.images ||
          state.ticketData.images.length === 0 ||
          text
        ) {
          bot.sendMessage(
            chatId,
            `Por favor envía hasta ${MAX_IMAGES} imágenes (una por una) o selecciona una opción:`,
            { reply_markup: imageOptionsKeyboard }
          );
        }
        return; // Don't advance to next field
      }
    } else {
      // Handle text fields
      state.ticketData[currentField.field] = text;
      state.currentField++;

      if (state.currentField < ticketFields.length) {
        let replyMarkup;

        // If we're at the images field, show skip and cancel options
        if (ticketFields[state.currentField].field === "images") {
          replyMarkup = {
            inline_keyboard: [
              [{ text: "⏩ Omitir imágenes", callback_data: "skip_images" }],
              [
                {
                  text: "❌ Cancelar ticket",
                  callback_data: "cancel_creation",
                },
              ],
            ],
          };
        } else {
          replyMarkup = {
            inline_keyboard: [
              [{ text: "Cancelar", callback_data: "cancel_creation" }],
            ],
          };
        }

        bot.sendMessage(chatId, ticketFields[state.currentField].question, {
          parse_mode: "Markdown",
          reply_markup: replyMarkup,
        });
      } else {
        try {
          await createJiraTicket(chatId, state.ticketData, state.telegramInfo);
        } catch (error) {
          bot.sendMessage(chatId, `Error creando el ticket: ${error.message}`);
        }

        delete userStates[chatId];
        setTimeout(() => sendMainMenu(chatId), 1000);
      }
    }
  }
});

async function createJiraTicket(chatId, ticketData, telegramInfo) {
  try {
    const TELEGRAM_USERNAME_FIELD =
      `customfield_${process.env.JIRA_CF_TELEGRAM_USERNAME}` ||
      "customfield_10186";
    const TELEGRAM_NAME_FIELD =
      `customfield_${process.env.JIRA_CF_TELEGRAM_NAME}` || "customfield_10187";
    const TELEGRAM_ID_FIELD =
      `customfield_${process.env.JIRA_CF_TELEGRAM_ID}` || "customfield_10188";

    let description = ticketData.description;

    // Calculate dates
    const startDate = new Date();
    const dueDate = new Date();

    // Add due days based on category
    if (ticketData.category && ticketData.category.dueDays) {
      dueDate.setDate(startDate.getDate() + ticketData.category.dueDays);
    } else {
      dueDate.setDate(startDate.getDate() + 7); // Default to 7 days
    }

    // Format dates for Jira (YYYY-MM-DD)
    const startDateFormatted = startDate.toISOString().split("T")[0];
    const dueDateFormatted = dueDate.toISOString().split("T")[0];

    const issueData = {
      fields: {
        project: { key: "DES" },
        summary: ticketData.summary,
        description: description,
        issuetype: {
          name: ticketData.category
            ? ticketData.category.issueType
            : "Incidencia de Telegram",
        },
        [TELEGRAM_USERNAME_FIELD]: telegramInfo.username || "",
        [TELEGRAM_NAME_FIELD]: telegramInfo.name || "",
        [TELEGRAM_ID_FIELD]: telegramInfo.userId
          ? telegramInfo.userId.toString()
          : "",
        labels: [ticketData.category ? ticketData.category.name : "Error"], // Use labels instead of custom field
        customfield_10015: startDateFormatted, // Start date
        duedate: dueDateFormatted, // Due date
      },
    };

    const issue = await jira.addNewIssue(issueData);

    // Save ticket to database for tracking
    try {
      await db.saveTicket({
        jiraKey: issue.key,
        chatId: chatId,
        telegramUserId: telegramInfo.userId,
        category: ticketData.category ? ticketData.category.name : "Error",
        title: ticketData.summary,
        description: ticketData.description,
        status: "Backlog", // Default initial status
        priority: "Medium", // Default priority
        startDate: startDateFormatted,
        dueDate: dueDateFormatted,
      });
      console.log(`✅ Ticket ${issue.key} saved to database`);
    } catch (dbError) {
      console.error("Error saving ticket to database:", dbError);
      // Don't fail the whole process if DB save fails
    }

    // Process images if any
    if (ticketData.images && ticketData.images.length > 0) {
      const progressMsg = await bot.sendMessage(
        chatId,
        `⏳ Subiendo ${ticketData.images.length} imagen(es) a Jira...`
      );

      let successCount = 0;
      let failCount = 0;

      // Process each image and update progress
      for (let i = 0; i < ticketData.images.length; i++) {
        const imageData = ticketData.images[i];

        try {
          // Update progress message
          await bot
            .editMessageText(
              `⏳ Subiendo imagenes a Jira... (${i + 1}/${
                ticketData.images.length
              })`,
              {
                chat_id: chatId,
                message_id: progressMsg.message_id,
              }
            )
            .catch(() => {
              /* ignore edit errors */
            });

          const fileInfo = await bot.getFile(imageData.fileId);
          const filePath = fileInfo.file_path;
          const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`;

          const tempFilePath = path.join(
            TEMP_DIR,
            `${Date.now()}_${i}_${path.basename(filePath)}`
          );

          const response = await axios({
            method: "GET",
            url: fileUrl,
            responseType: "stream",
          });

          const writer = fs.createWriteStream(tempFilePath);
          response.data.pipe(writer);

          await new Promise((resolve, reject) => {
            writer.on("finish", resolve);
            writer.on("error", reject);
          });

          await jira.addAttachmentOnIssue(
            issue.key,
            fs.createReadStream(tempFilePath)
          );

          fs.unlinkSync(tempFilePath);
          successCount++;
        } catch (error) {
          console.error(`Error subiendo imagen ${i + 1} a Jira:`, error);
          failCount++;
        }
      }

      // Final upload status
      const uploadStatus =
        `✅ ${successCount} imagen(es) subida(s) correctamente` +
        (failCount > 0
          ? `\n⚠️ ${failCount} imagen(es) no se pudieron subir`
          : "");

      // Update the progress message with final status
      await bot
        .editMessageText(uploadStatus, {
          chat_id: chatId,
          message_id: progressMsg.message_id,
        })
        .catch(() => {
          // If editing fails, send a new message
          bot.sendMessage(chatId, uploadStatus);
        });
    }

    // Create a more detailed success message
    const categoryInfo = ticketData.category
      ? ticketData.category
      : { name: "Task", emoji: "🎫" };
    const dueDaysText = ticketData.category
      ? `${ticketData.category.dueDays} día${
          ticketData.category.dueDays > 1 ? "s" : ""
        }`
      : "7 días";

    bot.sendMessage(
      chatId,
      `✅ Ticket de *${categoryInfo.name}* creado correctamente!\n\n *ID:* ${issue.key}\n *Fecha de inicio:* ${startDateFormatted}\n *Fecha límite:* ${dueDateFormatted} (${dueDaysText})\n *URL:* ${process.env.JIRA_HOST}/browse/${issue.key}`,
      { parse_mode: "Markdown" }
    );

    return issue;
  } catch (error) {
    console.error("Error creando ticket de Jira:", error);
    throw error;
  }
}

async function listUserTickets(chatId, username, fullName) {
  try {
    const TELEGRAM_USERNAME_FIELD =
      process.env.JIRA_CF_TELEGRAM_USERNAME || "10186";
    const TELEGRAM_NAME_FIELD = process.env.JIRA_CF_TELEGRAM_NAME || "10187";

    let jqlQuery;

    if (username) {
      jqlQuery = `cf[${TELEGRAM_USERNAME_FIELD}] ~ "${username}" ORDER BY created DESC`;
    } else if (fullName) {
      jqlQuery = `cf[${TELEGRAM_NAME_FIELD}] ~ "${fullName}" ORDER BY created DESC`;
    } else {
      bot.sendMessage(
        chatId,
        "No se pudo determinar tu nombre de usuario de Telegram."
      );
      return;
    }

    const issues = await jira.searchJira(jqlQuery, { maxResults: 10 });

    if (issues.issues.length === 0) {
      bot.sendMessage(chatId, "No tenes ningun ticket aun.");

      const backKeyboard = {
        inline_keyboard: [
          [{ text: "Volver al menú", callback_data: "back_to_menu" }],
        ],
      };

      bot.sendMessage(chatId, "Te gustaria crear un nuevo ticket?", {
        parse_mode: "Markdown",
        reply_markup: backKeyboard,
      });
      return;
    }

    const ticketButtons = issues.issues.map((issue) => {
      const status = issue.fields.status.name;
      let statusEmoji = "🔄";

      if (status === "Finalizada") {
        statusEmoji = "✅";
      } else if (status === "Revisar") {
        statusEmoji = "🔎";
      } else if (status === "Paused") {
        statusEmoji = "⏳";
      } else if (status === "En Curso") {
        statusEmoji = "🚀";
      } else if (status === "Backlog") {
        statusEmoji = "📝";
      }

      return [
        {
          text: `${
            issue.key
          }: ${statusEmoji} ${status} - ${issue.fields.summary.substring(
            0,
            30
          )}${issue.fields.summary.length > 30 ? "..." : ""}`,
          callback_data: `view_ticket_${issue.key}`,
        },
      ];
    });

    ticketButtons.push([
      { text: "Volver al menú", callback_data: "back_to_menu" },
    ]);

    bot.sendMessage(chatId, "📜Estos son tus tickets recientes:\n", {
      parse_mode: "Markdown",
      reply_markup: { inline_keyboard: ticketButtons },
    });
  } catch (error) {
    console.error("Error listando tickets de Jira:", error);
    throw error;
  }
}

async function viewTicketDetails(chatId, ticketKey) {
  try {
    const issue = await jira.findIssue(ticketKey);

    const TELEGRAM_USERNAME_FIELD =
      `customfield_${process.env.JIRA_CF_TELEGRAM_USERNAME}` ||
      "customfield_10186";
    const TELEGRAM_NAME_FIELD =
      `customfield_${process.env.JIRA_CF_TELEGRAM_NAME}` || "customfield_10187";

    let telegramInfo = "";
    if (
      issue.fields[TELEGRAM_USERNAME_FIELD] ||
      issue.fields[TELEGRAM_NAME_FIELD]
    ) {
      telegramInfo = `\n*Creado por:* ${
        issue.fields[TELEGRAM_NAME_FIELD] || "Desconocido"
      } ${
        issue.fields[TELEGRAM_USERNAME_FIELD]
          ? `(@${issue.fields[TELEGRAM_USERNAME_FIELD]})`
          : ""
      }`;
    }

    // Format dates
    let dateInfo = "";
    if (issue.fields.customfield_10015) {
      dateInfo += `\n*Fecha de inicio:* ${issue.fields.customfield_10015}`;
    }
    if (issue.fields.duedate) {
      dateInfo += `\n*Fecha límite:* ${issue.fields.duedate}`;
    }

    // Category info from labels
    let categoryInfo = "";
    if (issue.fields.labels && issue.fields.labels.length > 0) {
      // Find the first label that matches our categories
      const categoryLabel = issue.fields.labels.find((label) =>
        ticketCategories.some((cat) => cat.name === label)
      );

      if (categoryLabel) {
        const category = ticketCategories.find(
          (cat) => cat.name === categoryLabel
        );
        const emoji = category ? category.emoji : "📋";
        categoryInfo = `\n*Categoría:* ${emoji} ${categoryLabel}`;
      }
    }

    const ticketDetails = `📄 *${issue.key}: ${
      issue.fields.summary
    }*\n\n*Estado:* ${issue.fields.status.name}\n*Tipo:* ${
      issue.fields.issuetype.name
    }\n*Prioridad:* ${
      issue.fields.priority.name
    }${categoryInfo}${dateInfo}\n*Creado:* ${new Date(
      issue.fields.created
    ).toLocaleString()}\n*Actualizado:* ${new Date(
      issue.fields.updated
    ).toLocaleString()}${telegramInfo}\n\n*Descripción:*\n${
      issue.fields.description || "No hay descripción"
    }`;

    let attachmentInfo = "";
    if (issue.fields.attachment && issue.fields.attachment.length > 0) {
      attachmentInfo = "\n\n*Archivos adjuntos:*\n";
      issue.fields.attachment.forEach((attachment) => {
        attachmentInfo += `- [${attachment.filename}](${attachment.content})\n`;
      });
    }

    const commentsCount = issue.fields.comment ? issue.fields.comment.total : 0;
    const commentsInfo =
      commentsCount > 0
        ? `\n\n*Comentarios:* ${commentsCount}`
        : "\n\n*No hay comentarios*";

    const backKeyboard = {
      inline_keyboard: [
        [
          {
            text: "💬 Ver comentarios",
            callback_data: `comments_ticket_${ticketKey}`,
          },
        ],
        [
          { text: "Volver al listado", callback_data: "back_to_list" },
          { text: "Volver al menú", callback_data: "back_to_menu" },
        ],
      ],
    };

    bot.sendMessage(chatId, ticketDetails + attachmentInfo + commentsInfo, {
      parse_mode: "Markdown",
      reply_markup: backKeyboard,
    });
  } catch (error) {
    console.error("Error viendo detalles del ticket:", error);
    throw error;
  }
}

async function viewTicketComments(chatId, ticketKey) {
  try {
    const issue = await jira.findIssue(ticketKey);

    if (!issue.fields.comment || issue.fields.comment.comments.length === 0) {
      bot.sendMessage(chatId, `No hay comentarios en el ticket ${ticketKey}.`, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "Volver a detalles",
                callback_data: `view_ticket_${ticketKey}`,
              },
            ],
          ],
        },
      });
      return;
    }

    // Sort comments by date (newest first)
    const comments = issue.fields.comment.comments.sort(
      (a, b) => new Date(b.created) - new Date(a.created)
    );

    // Format each comment
    let commentMessages = [];
    for (const comment of comments) {
      const author = comment.author.displayName;
      const date = new Date(comment.created).toLocaleString();
      const body = comment.body;

      // Telegram has message size limits, so we might need to split very long comments
      const formattedComment = `*${author} (${date}):*\n${body}\n\n${"─".repeat(
        20
      )}\n`;
      commentMessages.push(formattedComment);
    }

    // Send comments (handle potential size limits)
    const backKeyboard = {
      inline_keyboard: [
        [
          {
            text: "Volver a detalles",
            callback_data: `view_ticket_${ticketKey}`,
          },
        ],
      ],
    };

    // Send header first
    await bot.sendMessage(
      chatId,
      `-----------------------------------------------\n*Comentarios del ticket ${ticketKey}:*\n-----------------------------------------------`,
      { parse_mode: "Markdown" }
    );

    // Then send each comment (combine small comments if possible)
    let currentMessage = "";
    for (const comment of commentMessages) {
      if ((currentMessage + comment).length > 3800) {
        // Leave some margin for Markdown formatting
        await bot.sendMessage(chatId, currentMessage, {
          parse_mode: "Markdown",
        });
        currentMessage = comment;
      } else {
        currentMessage += comment;
      }
    }

    // Send any remaining comments with the back button
    if (currentMessage) {
      await bot.sendMessage(chatId, currentMessage, {
        parse_mode: "Markdown",
        reply_markup: backKeyboard,
      });
    } else {
      await bot.sendMessage(chatId, "Fin de los comentarios.", {
        parse_mode: "Markdown",
        reply_markup: backKeyboard,
      });
    }
  } catch (error) {
    console.error("Error viendo comentarios del ticket:", error);
    throw error;
  }
}

bot.onText(/\/cancel/, (msg) => {
  const chatId = msg.chat.id;

  if (userStates[chatId] && userStates[chatId].creating) {
    delete userStates[chatId];
    bot.sendMessage(chatId, "Creacion de ticket cancelado.");
    sendMainMenu(chatId);
  }
});

// Notification functions
async function enableNotifications(chatId, telegramInfo) {
  try {
    // Save to database
    await db.enableNotifications(chatId, telegramInfo);

    // Keep in memory for backwards compatibility (can be removed later)
    userNotifications[chatId] = {
      enabled: true,
      telegramInfo: telegramInfo,
      lastCheck: new Date(),
    };

    console.log(
      `🔔 Notifications enabled for user ${chatId} (${
        telegramInfo.username || telegramInfo.name
      })`
    );
    console.log(`👤 User info:`, telegramInfo);

    bot.sendMessage(
      chatId,
      `✅ Notificaciones habilitadas.\n\n Te avisaré cuando cambien el estado de tus tickets.\n Revisaré cada minuto.\n\n Buscando tickets para: ${
        telegramInfo.username ? `@${telegramInfo.username}` : telegramInfo.name
      }`
    );
  } catch (error) {
    console.error("Error enabling notifications:", error);
    bot.sendMessage(
      chatId,
      "❌ Error habilitando notificaciones. Intenta de nuevo."
    );
  }
}

async function disableNotifications(chatId) {
  try {
    // Remove from database
    await db.disableNotifications(chatId);

    // Remove from memory
    delete userNotifications[chatId];

    bot.sendMessage(chatId, "❌ Notificaciones deshabilitadas.");
  } catch (error) {
    console.error("Error disabling notifications:", error);
    bot.sendMessage(
      chatId,
      "❌ Error deshabilitando notificaciones. Intenta de nuevo."
    );
  }
}

async function checkTicketUpdates() {
  try {
    // Get all users with notifications enabled from database
    const enabledUsers = await db.getEnabledUsers();

    console.log(
      `🔍 Checking ticket updates for ${enabledUsers.length} users from database...`
    );

    for (const user of enabledUsers) {
      try {
        console.log(
          `📋 Checking updates for user ${user.chat_id} (${
            user.username || user.first_name
          })`
        );

        // Build JQL query to find user's tickets
        const TELEGRAM_USERNAME_FIELD =
          process.env.JIRA_CF_TELEGRAM_USERNAME || "10186";
        const TELEGRAM_NAME_FIELD =
          process.env.JIRA_CF_TELEGRAM_NAME || "10187";

        let jqlQuery;
        const fullName = `${user.first_name} ${user.last_name || ""}`.trim();

        if (user.username) {
          jqlQuery = `cf[${TELEGRAM_USERNAME_FIELD}] ~ "${user.username}" ORDER BY updated DESC`;
        } else if (fullName) {
          jqlQuery = `cf[${TELEGRAM_NAME_FIELD}] ~ "${fullName}" ORDER BY updated DESC`;
        } else {
          console.log(`⚠️ No username or name found for user ${user.chat_id}`);
          continue;
        }

        console.log(`🔎 JQL Query: ${jqlQuery}`);

        const issues = await jira.searchJira(jqlQuery, {
          maxResults: 10,
          expand: ["changelog"],
        });

        console.log(
          `📊 Found ${issues.issues.length} tickets for user ${user.chat_id}`
        );

        for (const issue of issues.issues) {
          console.log(
            `🎫 Processing ticket ${issue.key}, current status: ${issue.fields.status.name}`
          );

          // Update ticket status in our database
          await db.updateTicketStatus(issue.key, issue.fields.status.name);

          // Check if status changed in recent updates (last 5 minutes)
          const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

          if (issue.changelog && issue.changelog.histories) {
            console.log(
              `📜 Checking ${issue.changelog.histories.length} history entries for ${issue.key}`
            );

            for (const history of issue.changelog.histories) {
              const historyDate = new Date(history.created);

              // Only process recent changes (last 5 minutes)
              if (historyDate > fiveMinutesAgo) {
                console.log(
                  `⏰ Processing recent history entry from ${historyDate} for ${issue.key}`
                );

                for (const item of history.items) {
                  if (item.field === "status") {
                    console.log(
                      `🔄 Recent status change detected in ${issue.key}: ${item.fromString} -> ${item.toString}`
                    );

                    // Check if this status change already exists in our database
                    const changeExists = await db.statusChangeExists(
                      issue.key,
                      item.fromString,
                      item.toString,
                      history.created
                    );

                    if (changeExists) {
                      console.log(
                        `⏭️ Status change already processed for ${issue.key}: ${item.fromString} -> ${item.toString}, skipping`
                      );
                      continue;
                    }

                    console.log(
                      `🆕 New status change found for ${issue.key}: ${item.fromString} -> ${item.toString}`
                    );

                    // Save status change to database
                    const statusChangeId = await db.saveStatusChange(
                      issue.key,
                      item.fromString,
                      item.toString,
                      history.author.displayName,
                      history.created
                    );

                    const statusEmoji = getStatusEmoji(item.toString);

                    // Check if we've already sent a notification for this specific change to this user
                    const notificationExists = await db.notificationExists(
                      user.chat_id,
                      issue.key,
                      "status_change",
                      item.fromString,
                      item.toString
                    );

                    if (notificationExists) {
                      console.log(
                        `⏭️ Notification already sent to user ${user.chat_id} for ${issue.key}: ${item.fromString} -> ${item.toString}, skipping`
                      );
                      // Still mark the status change as sent to avoid future processing
                      await db.markNotificationSent(statusChangeId);
                      continue;
                    }

                    const message =
                      `🔔 *Actualización de ticket*\n\n` +
                      `*${issue.key}:* ${issue.fields.summary}\n` +
                      `Estado cambió de *${item.fromString}* a *${item.toString}* ${statusEmoji}\n` +
                      `Actualizado por: ${history.author.displayName}\n` +
                      `${new Date(history.created).toLocaleString()}\n\n`;

                    console.log(`📤 Sending notification to ${user.chat_id}`);

                    try {
                      await bot.sendMessage(user.chat_id, message, {
                        parse_mode: "Markdown",
                      });

                      // Save notification to database
                      await db.saveNotification(
                        user.chat_id,
                        issue.key,
                        "status_change",
                        item.fromString,
                        item.toString
                      );

                      // Mark notification as sent
                      await db.markNotificationSent(statusChangeId);

                      console.log(
                        `✅ Notification sent and logged for ${issue.key}`
                      );
                    } catch (sendError) {
                      console.error(
                        `❌ Error sending notification to ${user.chat_id}:`,
                        sendError
                      );
                    }
                  }
                }
              } else {
                console.log(
                  `⏭️ History entry from ${historyDate} is older than 5 minutes, skipping`
                );
              }
            }
          }
        }

        // Update the in-memory notification data if it exists (for backwards compatibility)
        if (userNotifications[user.chat_id]) {
          userNotifications[user.chat_id].lastCheck = new Date();
        }
      } catch (userError) {
        console.error(
          `❌ Error checking updates for user ${user.chat_id}:`,
          userError
        );
      }
    }
  } catch (error) {
    console.error("❌ Error in checkTicketUpdates:", error);
  }
}

function getStatusEmoji(status) {
  const statusLower = status.toLowerCase();
  if (statusLower.includes("finalizada") || statusLower.includes("done"))
    return "✅";
  if (statusLower.includes("curso") || statusLower.includes("progress"))
    return "🚀";
  if (statusLower.includes("revisar") || statusLower.includes("review"))
    return "🔎";
  if (statusLower.includes("paused") || statusLower.includes("pausa"))
    return "⏳";
  if (statusLower.includes("backlog")) return "📝";
  return "🔄";
}

// Start the notification checker
console.log(
  `🔔 Starting notification system - checking every ${
    NOTIFICATION_CHECK_INTERVAL / 1000
  } seconds`
);
setInterval(checkTicketUpdates, NOTIFICATION_CHECK_INTERVAL);

console.log("🤖 Bot is running...");
console.log("📋 Available commands:");
console.log("  /start - Main menu");
console.log("  /cancel - Cancel ticket creation");
