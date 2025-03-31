const TelegramBot = require("node-telegram-bot-api");
const JiraApi = require("jira-client");
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");
const axios = require("axios");

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

const userStates = {};
const TEMP_DIR = path.join(__dirname, "temp");

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR);
}

const ticketFields = [
  { field: "summary", question: "1️⃣ Ingrese el titulo del ticket:" },
  { field: "description", question: "2️⃣ Ingrese la descripción del ticket:" },
  { field: "image", question: "3️⃣ Adjunte una imagen (opcional):" },
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
  const mainMenuKeyboard = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "Crear ticket", callback_data: "create_ticket" },
          { text: "Ver mis tickets", callback_data: "list_tickets" },
        ],
      ],
    },
    parse_mode: "Markdown",
  };

  bot
    .sendMessage(
      chatId,
      "-----------------------------------------------\n*👋 Bienvenido al Bot de tickets de Jira!*\n\nQue te gustaria hacer?\n-----------------------------------------------",
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

    const cancelKeyboard = {
      inline_keyboard: [
        [{ text: "❌ Cancelar", callback_data: "cancel_creation" }],
      ],
    };

    bot.sendMessage(chatId, ticketFields[0].question, {
      parse_mode: "Markdown",
      reply_markup: cancelKeyboard,
    });
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
  } else if (action === "skip_image") {
    if (userStates[chatId] && userStates[chatId].creating) {
      const state = userStates[chatId];

      if (ticketFields[state.currentField].field === "image") {
        state.ticketData.image = null;
        state.currentField++;

        bot.sendMessage(
          chatId,
          "Imagen omitida. Continuando con la creacion del ticket..."
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

    // Handle image upload
    if (currentField.field === "image") {
      if (hasPhoto) {
        // Process photo upload
        const photo = msg.photo[msg.photo.length - 1]; // Get the largest photo
        const fileId = photo.file_id;

        try {
          // Save image information for later processing
          state.ticketData.image = {
            fileId: fileId,
            processed: false,
          };

          bot.sendMessage(chatId, "✅ Imagen recibida correctamente!");
          state.currentField++;

          // If we've finished collecting all fields
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
        } catch (error) {
          bot.sendMessage(
            chatId,
            `Error procesando la imagen: ${error.message}`
          );
          state.ticketData.image = null;
        }
      } else {
        // Display image options when user is at the image field but hasn't sent an image yet
        const imageOptionsKeyboard = {
          inline_keyboard: [
            [{ text: "⏩ Omitir imagen", callback_data: "skip_image" }],
            [{ text: "❌ Cancelar ticket", callback_data: "cancel_creation" }],
          ],
        };

        bot.sendMessage(
          chatId,
          "Por favor envía una imagen o selecciona una opción:",
          { reply_markup: imageOptionsKeyboard }
        );
        return; // Don't advance to next field
      }
    } else {
      // Handle text fields
      state.ticketData[currentField.field] = text;
      state.currentField++;

      if (state.currentField < ticketFields.length) {
        let replyMarkup;

        // If we're at the image field, show skip and cancel options
        if (ticketFields[state.currentField].field === "image") {
          replyMarkup = {
            inline_keyboard: [
              [{ text: "⏩ Omitir imagen", callback_data: "skip_image" }],
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
              [{ text: "❌ Cancelar", callback_data: "cancel_creation" }],
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
      "customfield_10152";
    const TELEGRAM_NAME_FIELD =
      `customfield_${process.env.JIRA_CF_TELEGRAM_NAME}` || "customfield_10153";

    let description = ticketData.description;

    const issueData = {
      fields: {
        project: { key: "PRJS" },
        summary: ticketData.summary,
        description: description,
        issuetype: { name: "Incidencia de Telegram" },
        [TELEGRAM_USERNAME_FIELD]: telegramInfo.username || "",
        [TELEGRAM_NAME_FIELD]: telegramInfo.name || "",
      },
    };

    const issue = await jira.addNewIssue(issueData);

    if (ticketData.image && ticketData.image.fileId) {
      bot.sendMessage(chatId, "⏳ Subiendo imagen a Jira...");

      try {
        const fileInfo = await bot.getFile(ticketData.image.fileId);
        const filePath = fileInfo.file_path;
        const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`;

        const tempFilePath = path.join(
          TEMP_DIR,
          `${Date.now()}_${path.basename(filePath)}`
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

        bot.sendMessage(chatId, "✅ Imagen subida correctamente!");
      } catch (error) {
        console.error("Error subiendo imagen a Jira:", error);
        bot.sendMessage(
          chatId,
          "⚠️ No se pudo adjuntar la imagen al ticket: ${imgError.message}"
        );
      }
    }

    bot.sendMessage(
      chatId,
      `✅ Ticket creado correctamente!\n\nID: ${issue.key}\nURL: ${process.env.JIRA_HOST}/browse/${issue.key}`
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
      process.env.JIRA_CF_TELEGRAM_USERNAME || "cf[10152]";
    const TELEGRAM_NAME_FIELD =
      process.env.JIRA_CF_TELEGRAM_NAME || "cf[10153]";

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
          [{ text: "🔙 Volver al menú", callback_data: "back_to_menu" }],
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
      { text: "🔙 Volver al menú", callback_data: "back_to_menu" },
    ]);

    bot.sendMessage(
      chatId,
      "-----------------------------------------------\n📜 Estos son tus tickets recientes:\n-----------------------------------------------",
      {
        parse_mode: "Markdown",
        reply_markup: { inline_keyboard: ticketButtons },
      }
    );
  } catch (error) {
    console.error("Error listando tickets de Jira:", error);
    throw error;
  }
}

async function viewTicketDetails(chatId, ticketKey) {
  try {
    const issue = await jira.findIssue(ticketKey);

    const TELEGRAM_USERNAME_FIELD =
      process.env.JIRA_CF_TELEGRAM_USERNAME || "customfield_10152";
    const TELEGRAM_NAME_FIELD =
      process.env.JIRA_CF_TELEGRAM_NAME || "customfield_10153";

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

    const ticketDetails = `📄 *${issue.key}: ${
      issue.fields.summary
    }*\n\n*Estado:* ${issue.fields.status.name}\n*Tipo:* ${
      issue.fields.issuetype.name
    }\n*Prioridad:* ${issue.fields.priority.name}\n*Creado:* ${new Date(
      issue.fields.created
    ).toLocaleString()}\n*Actualizado:* ${new Date(
      issue.fields.updated
    ).toLocaleString()}\n\n*Descripcion:*\n${
      issue.fields.description || "No hay descripcion"
    }`;

    let attachmentInfo = "";
    if (issue.fields.attachment && issue.fields.attachment.length > 0) {
      attachmentInfo = "\n\n*Arvhicos adjuntos:*";
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
          { text: "🔙 Volver al listado", callback_data: "back_to_list" },
          { text: "🔙 Volver al menú", callback_data: "back_to_menu" },
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
                text: "🔙 Volver a detalles",
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
            text: "🔙 Volver a detalles",
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

console.log("Bot is running...");
