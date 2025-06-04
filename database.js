const sqlite3 = require("sqlite3").verbose();
const path = require("path");

class Database {
  constructor() {
    this.dbPath = path.join(__dirname, "bot_data.db");
    this.db = null;
    this.init();
  }

  init() {
    this.db = new sqlite3.Database(this.dbPath, (err) => {
      if (err) {
        console.error("Error opening database:", err.message);
      } else {
        console.log("✅ Connected to SQLite database");
        this.createTables();
      }
    });
  }

  createTables() {
    // Users table for notification preferences
    this.db.run(`
      CREATE TABLE IF NOT EXISTS users (
        chat_id INTEGER PRIMARY KEY,
        telegram_user_id INTEGER,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        notifications_enabled INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Tickets table for tracking created tickets
    this.db.run(`
      CREATE TABLE IF NOT EXISTS tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jira_key TEXT UNIQUE,
        chat_id INTEGER,
        telegram_user_id INTEGER,
        category TEXT,
        title TEXT,
        description TEXT,
        status TEXT,
        priority TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        start_date DATE,
        due_date DATE,
        FOREIGN KEY (chat_id) REFERENCES users (chat_id)
      )
    `);

    // Notifications table for tracking sent notifications
    this.db.run(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id INTEGER,
        jira_key TEXT,
        notification_type TEXT, -- 'status_change', 'comment_added', etc.
        old_value TEXT,
        new_value TEXT,
        sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (chat_id) REFERENCES users (chat_id),
        FOREIGN KEY (jira_key) REFERENCES tickets (jira_key)
      )
    `);

    // Status changes table for detailed tracking
    this.db.run(`
      CREATE TABLE IF NOT EXISTS status_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jira_key TEXT,
        old_status TEXT,
        new_status TEXT,
        changed_by TEXT,
        changed_at DATETIME,
        notification_sent INTEGER DEFAULT 0,
        FOREIGN KEY (jira_key) REFERENCES tickets (jira_key)
      )
    `);

    console.log("✅ Database tables created/verified");
  }

  // User management methods
  async saveUser(chatId, telegramInfo) {
    return new Promise((resolve, reject) => {
      const { userId, name, username } = telegramInfo;
      const [firstName, lastName] = (name || "").split(" ");

      this.db.run(
        `
        INSERT OR REPLACE INTO users
        (chat_id, telegram_user_id, username, first_name, last_name, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
        [chatId, userId, username, firstName, lastName || ""],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.lastID);
          }
        }
      );
    });
  }

  async enableNotifications(chatId, telegramInfo) {
    await this.saveUser(chatId, telegramInfo);
    return new Promise((resolve, reject) => {
      this.db.run(
        `
        UPDATE users SET notifications_enabled = 1, updated_at = CURRENT_TIMESTAMP
        WHERE chat_id = ?
      `,
        [chatId],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.changes);
          }
        }
      );
    });
  }

  async disableNotifications(chatId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `
        UPDATE users SET notifications_enabled = 0, updated_at = CURRENT_TIMESTAMP
        WHERE chat_id = ?
      `,
        [chatId],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.changes);
          }
        }
      );
    });
  }

  async getEnabledUsers() {
    return new Promise((resolve, reject) => {
      this.db.all(
        `
        SELECT chat_id, telegram_user_id, username, first_name, last_name
        FROM users
        WHERE notifications_enabled = 1
      `,
        [],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        }
      );
    });
  }

  // Ticket management methods
  async saveTicket(ticketData) {
    return new Promise((resolve, reject) => {
      const {
        jiraKey,
        chatId,
        telegramUserId,
        category,
        title,
        description,
        status,
        priority,
        startDate,
        dueDate,
      } = ticketData;

      this.db.run(
        `
        INSERT OR REPLACE INTO tickets
        (jira_key, chat_id, telegram_user_id, category, title, description,
         status, priority, start_date, due_date, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `,
        [
          jiraKey,
          chatId,
          telegramUserId,
          category,
          title,
          description,
          status,
          priority,
          startDate,
          dueDate,
        ],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.lastID);
          }
        }
      );
    });
  }

  async updateTicketStatus(jiraKey, newStatus) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `
        UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE jira_key = ?
      `,
        [newStatus, jiraKey],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.changes);
          }
        }
      );
    });
  }

  // Status change tracking
  async saveStatusChange(jiraKey, oldStatus, newStatus, changedBy, changedAt) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `
        INSERT INTO status_changes
        (jira_key, old_status, new_status, changed_by, changed_at)
        VALUES (?, ?, ?, ?, ?)
      `,
        [jiraKey, oldStatus, newStatus, changedBy, changedAt],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.lastID);
          }
        }
      );
    });
  }

  // Check if a status change already exists
  async statusChangeExists(jiraKey, oldStatus, newStatus, changedAt) {
    return new Promise((resolve, reject) => {
      // Check if a status change with the same details already exists
      // We'll check within a 1-minute window to account for slight time differences
      const changedAtDate = new Date(changedAt);
      const oneMinuteBefore = new Date(changedAtDate.getTime() - 60 * 1000);
      const oneMinuteAfter = new Date(changedAtDate.getTime() + 60 * 1000);

      this.db.get(
        `
        SELECT id FROM status_changes
        WHERE jira_key = ?
          AND old_status = ?
          AND new_status = ?
          AND changed_at BETWEEN ? AND ?
        LIMIT 1
      `,
        [
          jiraKey,
          oldStatus,
          newStatus,
          oneMinuteBefore.toISOString(),
          oneMinuteAfter.toISOString(),
        ],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(!!row); // Returns true if exists, false if not
          }
        }
      );
    });
  }

  async markNotificationSent(statusChangeId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `
        UPDATE status_changes SET notification_sent = 1 WHERE id = ?
      `,
        [statusChangeId],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.changes);
          }
        }
      );
    });
  }

  // Notification tracking
  async saveNotification(
    chatId,
    jiraKey,
    notificationType,
    oldValue,
    newValue
  ) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `
        INSERT INTO notifications
        (chat_id, jira_key, notification_type, old_value, new_value)
        VALUES (?, ?, ?, ?, ?)
      `,
        [chatId, jiraKey, notificationType, oldValue, newValue],
        function (err) {
          if (err) {
            reject(err);
          } else {
            resolve(this.lastID);
          }
        }
      );
    });
  }

  // Check if a notification has already been sent for this specific change
  async notificationExists(
    chatId,
    jiraKey,
    notificationType,
    oldValue,
    newValue
  ) {
    return new Promise((resolve, reject) => {
      this.db.get(
        `
        SELECT id FROM notifications
        WHERE chat_id = ?
          AND jira_key = ?
          AND notification_type = ?
          AND old_value = ?
          AND new_value = ?
        LIMIT 1
      `,
        [chatId, jiraKey, notificationType, oldValue, newValue],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(!!row); // Returns true if exists, false if not
          }
        }
      );
    });
  }

  // Get count of unsent notifications for monitoring
  async getUnsentNotificationsCount() {
    return new Promise((resolve, reject) => {
      this.db.get(
        `
        SELECT COUNT(*) as count
        FROM status_changes
        WHERE notification_sent = 0
      `,
        [],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row.count);
          }
        }
      );
    });
  }

  // Get tickets that need notification checking
  async getTicketsForNotificationCheck(chatId, username, fullName) {
    return new Promise((resolve, reject) => {
      let query = `
        SELECT jira_key, status
        FROM tickets
        WHERE chat_id = ?
      `;
      let params = [chatId];

      this.db.all(query, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  close() {
    return new Promise((resolve) => {
      this.db.close((err) => {
        if (err) {
          console.error("Error closing database:", err.message);
        } else {
          console.log("✅ Database connection closed");
        }
        resolve();
      });
    });
  }
}

module.exports = Database;
