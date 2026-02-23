import { Bot } from 'grammy'

import { BOT_TOKEN } from './utils'

export const createBot = (): Bot => {
    const bot = new Bot(BOT_TOKEN)
    void bot.api.setMyCommands([{ command: 'new', description: 'Clear session and start fresh' }])

    bot.command('new', async (ctx) => {
        await ctx.reply('Session cleared! 🪼')
    })

    bot.on('message', (ctx) => ctx.reply('Got another message!'))

    bot.catch((error) => console.error('Telegram Bot Error:', error))

    return bot
}
