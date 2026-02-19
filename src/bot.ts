import { Bot, Context } from 'grammy'
import { runAgent } from './agent'
import { addCron, loadCrons, removeCron } from './cron'
import { clearSession, loadSession } from './session'

const parseAllowedChatIds = (value: string | undefined): Set<string> => {
    if (!value) {
        return new Set<string>()
    }
    return new Set(
        value
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean)
    )
}

const isAllowedChat = (chatId: string, allowlist: Set<string>): boolean => allowlist.has(chatId)

const parseCronAddArgs = (input: string): { schedule: string; prompt: string } | null => {
    const trimmed = input.trim()
    if (!trimmed) {
        return null
    }

    if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
        const quote = trimmed[0]
        if (!quote) {
            return null
        }
        const closingIdx = trimmed.indexOf(quote, 1)
        if (closingIdx <= 1) {
            return null
        }
        const schedule = trimmed.slice(1, closingIdx).trim()
        const prompt = trimmed.slice(closingIdx + 1).trim()
        if (!schedule || !prompt) {
            return null
        }
        return { schedule, prompt }
    }

    const parts = trimmed.split(/\s+/)
    for (const cronFieldCount of [5, 6]) {
        if (parts.length <= cronFieldCount) {
            continue
        }
        const schedule = parts.slice(0, cronFieldCount).join(' ')
        const prompt = parts.slice(cronFieldCount).join(' ').trim()
        if (!prompt) {
            continue
        }
        return { schedule, prompt }
    }

    return null
}

const cronHelpText = [
    '🕐 Cron commands:',
    '',
    '/cron list — list your cron jobs',
    '/cron add <schedule> <prompt> — create a new cron job',
    '  Example: /cron add "0 9 * * *" Give me a morning weather summary',
    '/cron remove <id> — delete a cron job',
    '',
    'Schedule format: standard cron (minute hour day month weekday)',
    'Examples:',
    '  0 9 * * *     — every day at 9am',
    '  0 9 * * 1     — every Monday at 9am',
    '  */30 * * * *  — every 30 minutes'
].join('\n')

const safeEditMessage = async (bot: Bot, chatId: number, messageId: number, text: string): Promise<void> => {
    try {
        await bot.api.editMessageText(chatId, messageId, text)
    } catch (error) {
        const err = error as { description?: string }
        if (typeof err.description === 'string' && err.description.includes('message is not modified')) {
            return
        }
        throw error
    }
}

const startTypingLoop = (ctx: Context): NodeJS.Timeout =>
    setInterval(() => {
        void ctx.replyWithChatAction('typing')
    }, 4000)

const runCommand = async (cmd: string[], cwd: string): Promise<string> => {
    const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    const output = [stdout, stderr].filter(Boolean).join('\n').trim()
    if (exitCode !== 0) {
        throw new Error(output || `Command failed: ${cmd.join(' ')}`)
    }
    return output
}

export const createBot = (): Bot => {
    const token = process.env.BOT_TOKEN
    if (!token) {
        throw new Error('Missing BOT_TOKEN')
    }

    const allowedChats = parseAllowedChatIds(process.env.ALLOWED_CHAT_IDS)
    const bot = new Bot(token)

    bot.command('new', async (ctx) => {
        const chatId = String(ctx.chat?.id ?? '')
        if (!chatId) {
            return
        }
        if (!isAllowedChat(chatId, allowedChats)) {
            await ctx.reply('Access denied.')
            return
        }

        await clearSession(chatId)
        await ctx.reply('Session cleared! Fresh start 🪼')
    })

    bot.command('status', async (ctx) => {
        const chatId = String(ctx.chat?.id ?? '')
        if (!chatId) {
            return
        }
        if (!isAllowedChat(chatId, allowedChats)) {
            await ctx.reply('Access denied.')
            return
        }

        const messages = await loadSession(chatId)
        await ctx.reply(`Session has ${messages.length} messages.`)
    })

    bot.command('update', async (ctx) => {
        const chatId = String(ctx.chat?.id ?? '')
        if (!chatId) {
            return
        }
        if (!isAllowedChat(chatId, allowedChats)) {
            await ctx.reply('Access denied.')
            return
        }

        await ctx.reply('⬆️ Updating jellyfish-ai...')

        try {
            const cwd = `${import.meta.dir}/..`
            await runCommand(['git', 'pull', 'origin', 'main'], cwd)
            await runCommand(['bun', 'install', '--frozen-lockfile'], cwd)
            const { version } = (await import('../package.json')) as { version: string }
            await ctx.reply(`✅ Updated to v${version} — restarting...`)
            await runCommand(['pm2', 'restart', 'jellyfish-ai'], cwd)
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            await ctx.reply(`❌ Update failed: ${message}`)
        }
    })

    bot.command('cron', async (ctx) => {
        const chatId = String(ctx.chat?.id ?? '')
        if (!chatId) {
            return
        }
        if (!isAllowedChat(chatId, allowedChats)) {
            await ctx.reply('Access denied.')
            return
        }

        const args = ctx.match.trim()
        if (!args || args === 'help') {
            await ctx.reply(cronHelpText)
            return
        }

        if (args === 'list') {
            const allJobs = await loadCrons()
            const chatJobs = allJobs.filter((job) => job.chatId === chatId)
            if (chatJobs.length === 0) {
                await ctx.reply('No cron jobs set. Use /cron add <schedule> <prompt> to create one.')
                return
            }

            const lines = ['🕐 Active cron jobs:', '']
            for (const [index, job] of chatJobs.entries()) {
                lines.push(`${index + 1}. ID: ${job.id}`)
                lines.push(`   Schedule: ${job.schedule}`)
                lines.push(`   Prompt: ${job.prompt}`)
                lines.push('')
            }
            lines.push('Use /cron remove <id> to delete.')
            await ctx.reply(lines.join('\n'))
            return
        }

        if (args.startsWith('add ')) {
            const parsed = parseCronAddArgs(args.slice(4))
            if (!parsed) {
                await ctx.reply('Invalid usage. Use /cron add <schedule> <prompt>.')
                return
            }
            try {
                const created = await addCron(parsed.schedule, parsed.prompt, chatId)
                await ctx.reply(`✅ Cron job added! ID: ${created.id} | Schedule: ${created.schedule} | Prompt: ${created.prompt}`)
            } catch (error) {
                const message = error instanceof Error && error.message === 'Invalid cron expression' ? 'Invalid cron expression.' : 'Failed to add cron job.'
                await ctx.reply(`❌ ${message}`)
            }
            return
        }

        if (args.startsWith('remove ')) {
            const id = args.slice(7).trim()
            if (!id) {
                await ctx.reply('Invalid usage. Use /cron remove <id>.')
                return
            }

            const allJobs = await loadCrons()
            const target = allJobs.find((job) => job.id === id && job.chatId === chatId)
            if (!target) {
                await ctx.reply('❌ Not found.')
                return
            }

            const removed = await removeCron(id)
            await ctx.reply(removed ? '✅ Removed.' : '❌ Not found.')
            return
        }

        await ctx.reply(cronHelpText)
    })

    bot.on('message:text', async (ctx) => {
        const chatIdNumber = ctx.chat.id
        const chatId = String(chatIdNumber)
        const text = ctx.message.text

        if (!isAllowedChat(chatId, allowedChats)) {
            await ctx.reply('Access denied.')
            return
        }

        const typingLoop = startTypingLoop(ctx)
        await ctx.replyWithChatAction('typing')

        let draftMessageId: number | undefined
        let lastSentText = ''
        let lastUpdateMs = 0

        try {
            const draft = await ctx.reply('Thinking...')
            draftMessageId = draft.message_id

            const finalText = await runAgent(chatId, text, async (partialText) => {
                if (!draftMessageId) {
                    return
                }

                const now = Date.now()
                if (partialText === lastSentText) {
                    return
                }
                if (now - lastUpdateMs < 700) {
                    return
                }

                await safeEditMessage(bot, chatIdNumber, draftMessageId, partialText)
                lastSentText = partialText
                lastUpdateMs = now
            })

            if (draftMessageId) {
                await safeEditMessage(bot, chatIdNumber, draftMessageId, finalText)
            } else {
                await ctx.reply(finalText)
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error'
            const visibleError = `Agent error: ${message}`
            if (draftMessageId) {
                await safeEditMessage(bot, chatIdNumber, draftMessageId, visibleError)
            } else {
                await ctx.reply(visibleError)
            }
            console.error('Agent execution failed:', error)
        } finally {
            clearInterval(typingLoop)
        }
    })

    bot.catch((error) => {
        console.error('Telegram bot error:', error.error)
    })

    return bot
}
