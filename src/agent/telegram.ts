import { Bot, Context } from 'grammy'

import { BOT_TOKEN } from './utils'

export const createBot = (): Bot => {
    const bot = new Bot(BOT_TOKEN)
    void bot.api.setMyCommands([{ command: 'new', description: 'Clear session and start fresh' }])

    bot.command('new', async (ctx) => {
        await ctx.reply('Session cleared! 🪼')
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

const startTypingLoop = (ctx: Context): NodeJS.Timeout => {
    void ctx.replyWithChatAction('typing')
    return setInterval(() => {
        void ctx.replyWithChatAction('typing')
    }, 4000)
}
