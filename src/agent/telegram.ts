import { Bot, Context, type Filter, type NextFunction } from 'grammy'

import { run } from './agent'
import { ALLOWED_CHAT_IDS, BOT_TOKEN } from './utils'

export function createBot(): Bot {
    const bot = new Bot(BOT_TOKEN)

    bot.use(async (ctx: Context, next: NextFunction): Promise<void> => {
        const before = Date.now()
        const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id
        if (!chatId || !ALLOWED_CHAT_IDS.includes(chatId)) {
            return
        }
        await next()
        const after = Date.now()
        console.log(`Response Time: ${after - before} ms`)
    })

    void bot.api.setMyCommands([
        { command: 'new', description: 'Clear session and start fresh' },
        { command: 'session', description: 'Session Manager' }
    ])

    bot.command('start', (ctx) => ctx.reply('Welcome! 🪼'))

    bot.command('new', async (ctx) => {
        await clearSession(ctx.chat.id)
        alwaysAllowedByChat.delete(ctx.chat.id)
        await ctx.reply('New Session! 🪼')
    })

    bot.command('session', async (ctx) => {
        const keyboard = new InlineKeyboard()
            .text('Details', 'sess:details')
            .text('Resume', 'sess:resume')
            .row()
            .text('Remove', 'sess:remove')
            .text('Cancel', 'sess:cancel')
        await ctx.reply('Session Manager 🪼', { reply_markup: keyboard })
    })


    bot.on('message', async (ctx) => {
        const stopProcessing = startProcessing(ctx)
        try {
            const response = await run(ctx.message.text || '')
            await sendFormattedReply(ctx, response)
        } finally {
            stopProcessing()
        }
    })

    bot.catch((error) => console.error('Telegram Bot Error:', error))

    return bot
}

function startProcessing(ctx: Filter<Context, 'message'>) {
    ctx.replyWithChatAction('typing')
    const typingLoop = setInterval(() => ctx.replyWithChatAction('typing'), 4000).unref()
    return () => {
        clearInterval(typingLoop)
    }
}

async function sendFormattedReply(ctx: Context, text: string): Promise<void> {
    try {
        await ctx.reply(text, { parse_mode: 'MarkdownV2' })
    } catch {
        const plain = text.replace(/\\([_*[\]()~`>#+=|{}.!-])/g, '$1')
        try {
            await ctx.reply(plain.replace(/([_*[\]()~`>#+=|{}.!-])/g, '\\$1'), { parse_mode: 'MarkdownV2' })
        } catch {
            await ctx.reply(plain)
        }
    }
}
