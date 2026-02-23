import { Bot, Context } from 'grammy'

import { BOT_TOKEN } from './utils'

export function createBot(): Bot {
    const bot = new Bot(BOT_TOKEN)
    void bot.api.setMyCommands([{ command: 'new', description: 'Clear session and start fresh' }])

    bot.command('new', (ctx) => {
        ctx.reply('Session cleared! 🪼')
    })

    bot.on('message', (ctx) => {
        const typingLoop = startTypingLoop(ctx)
        try {
            ctx.reply('Received your message! 📨')
        } finally {
            clearInterval(typingLoop)
        }
    })

    bot.catch((error) => console.error('Telegram Bot Error:', error))

    return bot
}

function startTypingLoop(ctx: Context): NodeJS.Timeout {
    ctx.replyWithChatAction('typing')
    return setInterval(() => {
        ctx.replyWithChatAction('typing')
    }, 4000)
}
