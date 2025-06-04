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
- Sqlite3

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

Copia el archivo .env.example a .env y reemplaza los valores

```sh
cp .env.example .env
```

### 4. Correr el bot

```sh
node bot.js
```

## Uso

- Inicia el bot con el comando `/start`.
- Usa los botones de linea para crear o listar los tickets de Jira o para activar/desactivar las notificaciones.
- Responde los prompts del bot para crear un nuevo ticket.

## Comandos

| Comando   | Descripcion                    |
| --------- | ------------------------------ |
| `/start`  | Abre el menu principal         |
| `/cancel` | Cancela la creacion del ticket |

## Technologias Usadas

- `node-telegram-bot-api`
- `jira-client`
- `dotenv`
- `sqlite3`
- `axios`

## Licencia

Este proyecto fue desarrollado por Leandro Robert.
