if (!process.env.BOT_TOKEN) {
    throw new Error('Missing BOT_TOKEN')
}

export const BOT_TOKEN = process.env.BOT_TOKEN

export const ALLOWED_CHAT_IDS = [665725839]
