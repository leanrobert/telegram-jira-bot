# Telegram Jira Bot

Este bot integra Telegram con Jira, permitiendo crear, ver y listar los tickets de Jira en Telegram.

## Caracteristicas
- Crecion de tickets de Jira con guia de pasos.
- Listado de tickets creados por el usuario.
- Vista de detalles del ticket, incluyendo estado y descripcion.
- Navegacion con teclado menu de navegacion.
- Manejo de errores y logs.

## Requirements
- Node.js instalado
- Cuenta de Jira para obtener el API Token
- Un token de bot de telegram

## Setup

### 1. Clonar el Repositorio
```sh
git clone https://github.com/your-repo/telegram-jira-bot.git
cd telegram-jira-bot
```

### 2. Instalar Dependencias
```sh
npm install
```

### 3. Configurar Variables de Entorno
Crea un archivo llamado en el root del proyecto `.env` y añadi:
```sh
JIRA_HOST=your-jira-instance.atlassian.net
JIRA_USERNAME=your-jira-email@example.com
JIRA_API_TOKEN=your-jira-api-token
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
JIRA_CF_TELEGRAM_USERNAME=customfield_10152
JIRA_CF_TELEGRAM_NAME=customfield_10153
```

### 4. Correr el bot
```sh
node bot.js
```

## Uso
- Inicia el bot con el comando `/start`.
- Usa los botones de linea para crear o listar los tickets de Jira.
- Responde los prompts del bot para crear un nuevo ticket.

## Comandos
| Comando | Descripcion |
|---------|-------------|
| `/start` | Abre el menu principal |
| `/cancel` | Cancela la creacion del ticket |

## Technologias Usadas
- `node-telegram-bot-api`
- `jira-client`
- `dotenv`

## Licencia
Este proyecto fue desarrollado por Leandro Robert.

