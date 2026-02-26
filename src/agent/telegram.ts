import { Bot, Context, type Filter, type NextFunction } from 'grammy'

import { run } from './agent'
import { ALLOWED_CHAT_IDS, BOT_TOKEN } from './utils'

async function accessMiddleware(ctx: Context, next: NextFunction): Promise<void> {
    const before = Date.now()
    const chatId = ctx.chat?.id ?? ctx.callbackQuery?.message?.chat?.id
    if (!chatId || !ALLOWED_CHAT_IDS.includes(chatId)) {
        return
    }
    await next()
    const after = Date.now()
    console.log(`Response Time: ${after - before} ms`)
}

export function createBot(): Bot {
    const bot = new Bot(BOT_TOKEN)

    bot.use(accessMiddleware)

    void bot.api.setMyCommands([
        { command: 'new', description: 'Clear session and start fresh' },
        { command: 'sessions', description: 'List active session count' }
    ])

    bot.command('start', (ctx) => ctx.reply('Welcome! 🪼'))

    bot.command('new', (ctx) => ctx.reply('New Session! 🪼'))

    bot.command('sessions', async (ctx) => {
        const sessions = await listSessions({ dir: process.cwd() })
        console.log(sessions.map((session) => session.summary))
        ctx.reply(`Active sessions: ${sessions.length}`)
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
