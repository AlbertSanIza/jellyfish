if (!process.env.ALLOWED_CHAT_IDS) {
    throw new Error('Missing ALLOWED_CHAT_IDS')
}
if (!process.env.BOT_TOKEN) {
    throw new Error('Missing BOT_TOKEN')
}

export const ALLOWED_CHAT_IDS = process.env.ALLOWED_CHAT_IDS
export const BOT_TOKEN = process.env.BOT_TOKEN
