import { Bot, Context, InputFile, type NextFunction } from 'grammy'
import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runAgent } from './agent'
import { addCron, loadCrons, removeCron } from './cron'
import { killJob, listJobs, loadJobs, spawnJob, type AgentName } from './jobs'
import { clearAlwaysAllowed, createCanUseTool, handlePermissionCallback } from './permissions'
import { clearSession, loadSession } from './session'
import { drainPendingFilesForChat } from './tools'
import { ALLOWED_CHAT_IDS, BOT_TOKEN } from './utils'

const inboxDir = path.join(os.homedir(), '.jellyfish', 'inbox')
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tif', '.tiff'])

export const createBot = (): Bot => {
    const allowedChats = parseAllowedChatIds(ALLOWED_CHAT_IDS)
    const bot = new Bot(BOT_TOKEN)
    void bot.api.setMyCommands([
        { command: 'new', description: 'Clear session and start fresh' }
        // { command: 'status', description: 'Check session status' },
        // { command: 'update', description: 'Update and restart the bot' },
        // { command: 'cron', description: 'Manage cron jobs' },
        // { command: 'run', description: 'Run a background agent job' },
        // { command: 'jobs', description: 'List running jobs' },
        // { command: 'kill', description: 'Kill a job by ID' }
    ])
    bot.use(accessControlMiddleware(allowedChats))

    bot.command('new', async (ctx) => {
        await clearSession(ctx.chat!.id)
        await ctx.reply('Session cleared! Fresh start 🪼')
    })

    bot.command('status', async (ctx) => {
        const session = await loadSession(ctx.chat!.id)
        await ctx.reply(`Session has ${session.messages.length} messages.`)
    })

    bot.command('update', async (ctx) => {
        await ctx.reply('⬆️ Updating jellyfish...')
        try {
            const cwd = `${import.meta.dir}/..`
            const branch = (await runCommand(['git', 'rev-parse', '--abbrev-ref', 'HEAD'], cwd)).trim()
            await runCommand(['git', 'pull', 'origin', branch], cwd)
            await runCommand(['bun', 'install', '--frozen-lockfile'], cwd)
            const { version } = (await import('../package.json')) as { version: string }
            await ctx.reply(`✅ Updated to v${version} — restarting...`)
            await runCommand(['pm2', 'restart', 'jellyfish'], cwd)
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            await ctx.reply(`❌ Update failed: ${message}`)
        }
    })

    bot.command('cron', async (ctx) => {
        const chatId = String(ctx.chat!.id)
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

    bot.command('run', async (ctx) => {
        const chatId = String(ctx.chat!.id)
        const parsed = parseRunArgs(ctx.match)
        if (!parsed) {
            await ctx.reply('Usage: /run <codex|opencode|claude> [--workdir /path] <task>')
            return
        }
        const job = await spawnJob(parsed.agent, parsed.task, parsed.workdir, chatId, async (completedJob) => {
            const shortId = completedJob.id.slice(0, 8)
            const output = completedJob.output.slice(-2000) || '(no output)'
            const statusLabel = completedJob.status === 'done' ? '✅ Done' : '❌ Failed'
            const text = `${statusLabel}: ${completedJob.agent} [${shortId}]\nTask: ${completedJob.task}\n\nOutput:\n${output}`
            await bot.api.sendMessage(Number(completedJob.chatId), text)
        })
        const shortId = job.id.slice(0, 8)
        await ctx.reply(
            `🚀 Started ${job.agent} [${shortId}]\nTask: ${job.task}\nWorkdir: ${job.workdir}\n\nI'll notify you when it finishes. Use /jobs to check or /kill ${shortId} to stop.`
        )
    })

    bot.command('jobs', async (ctx) => {
        const chatId = String(ctx.chat!.id)
        const jobs = await listJobs(chatId)
        if (jobs.length === 0) {
            await ctx.reply('No jobs yet. Use /run <codex|opencode|claude> <task>.')
            return
        }
        const emojiByStatus = { running: '⏳', done: '✅', failed: '❌', killed: '🛑' } as const
        const lines = jobs.map(
            (job) =>
                `[${job.id.slice(0, 8)}] ${job.agent} — ${emojiByStatus[job.status]}\n   Task: ${job.task}\n   Started: ${formatRelativeTime(job.startedAt)}`
        )
        await ctx.reply(lines.join('\n\n'))
    })

    bot.command('kill', async (ctx) => {
        const chatId = String(ctx.chat!.id)
        const idPrefix = ctx.match.trim()
        if (!idPrefix) {
            await ctx.reply('Usage: /kill <job-id-prefix>')
            return
        }
        const jobs = await loadJobs()
        const target = jobs.find((job) => job.chatId === chatId && job.id.startsWith(idPrefix))
        if (!target) {
            await ctx.reply('❌ Job not found.')
            return
        }
        const killed = await killJob(target.id)
        await ctx.reply(killed ? `✅ Killed job [${killed.id.slice(0, 8)}].` : '❌ Job not found.')
    })

    bot.on('callback_query:data', async (ctx) => {
        const handled = await handlePermissionCallback(bot.api, ctx.callbackQuery)
        if (!handled) {
            await ctx.answerCallbackQuery({ text: 'Unknown action' })
        }
    })

    bot.on('message:text', async (ctx) => {
        const typingLoop = startTypingLoop(ctx)
        await setProcessingReaction(ctx, true)
        try {
            const canUseTool = createCanUseTool(bot.api, ctx.chat.id)
            const finalText = await runAgent(ctx.chat.id, ctx.message.text, undefined, canUseTool)
            await sendFormattedReply(ctx, finalText)
            await sendPendingFiles(ctx)
        } catch (error) {
            void drainPendingFilesForChat(ctx.chat.id)
            const visibleError = `Agent Error: ${error instanceof Error ? error.message : 'Unknown'}`
            console.error(visibleError)
            await ctx.reply(visibleError)
        } finally {
            clearInterval(typingLoop)
            await setProcessingReaction(ctx, false)
        }
    })

    bot.on('message:photo', async (ctx) => {
        const typingLoop = startTypingLoop(ctx)
        await setProcessingReaction(ctx, true)
        try {
            const largestPhoto = ctx.message.photo.at(-1)
            if (!largestPhoto) {
                await ctx.reply('I could not process that photo.')
                return
            }

            const telegramFile = await ctx.api.getFile(largestPhoto.file_id)
            if (!telegramFile.file_path) {
                await ctx.reply('I could not download that photo from Telegram.')
                return
            }

            await mkdir(inboxDir, { recursive: true })
            const imagePath = path.join(inboxDir, `${Date.now()}-${largestPhoto.file_unique_id}.jpg`)
            const downloadUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${telegramFile.file_path}`
            const response = await fetch(downloadUrl)
            if (!response.ok) {
                throw new Error(`Telegram file download failed (${response.status})`)
            }
            await Bun.write(imagePath, response)

            const caption = ctx.message.caption?.trim()
            const prompt = `[Image: ${imagePath}]\n${caption && caption.length > 0 ? caption : 'The user sent you this image.'}`

            const canUseTool = createCanUseTool(bot.api, ctx.chat.id)
            const finalText = await runAgent(ctx.chat.id, prompt, undefined, canUseTool)
            await sendFormattedReply(ctx, finalText)
            await sendPendingFiles(ctx)
        } catch (error) {
            void drainPendingFilesForChat(ctx.chat.id)
            const visibleError = `Agent Error: ${error instanceof Error ? error.message : 'Unknown'}`
            console.error(visibleError)
            await ctx.reply(visibleError)
        } finally {
            clearInterval(typingLoop)
            await setProcessingReaction(ctx, false)
        }
    })

    bot.catch((error) => console.error('Telegram Bot Error:', error))

    return bot
}

const escapeMarkdownV2 = (text: string): string => text.replace(/([_*[\]()~`>#+=|{}.!-])/g, '\\$1')

const sendFormattedReply = async (ctx: Context, text: string): Promise<void> => {
    try {
        await ctx.reply(text, { parse_mode: 'MarkdownV2' })
    } catch {
        // telegramifyMarkdown missed some chars — strip its escaping, re-escape everything, retry as MarkdownV2
        const plain = text.replace(/\\([_*[\]()~`>#+=|{}.!-])/g, '$1')
        try {
            await ctx.reply(escapeMarkdownV2(plain), { parse_mode: 'MarkdownV2' })
        } catch {
            // Last resort — send without any parse mode
            await ctx.reply(plain)
        }
    }
}

const startTypingLoop = (ctx: Context): NodeJS.Timeout => {
    void ctx.replyWithChatAction('typing')
    return setInterval(() => {
        void ctx.replyWithChatAction('typing')
    }, 4000)
}

const setProcessingReaction = async (ctx: Context, active: boolean): Promise<void> => {
    if (!ctx.chat?.id || !ctx.message?.message_id) {
        return
    }
    try {
        await ctx.api.setMessageReaction(ctx.chat.id, ctx.message.message_id, active ? [{ type: 'emoji', emoji: '👀' }] : [])
    } catch (error) {
        console.warn('Could not update processing reaction:', error)
    }
}

const sendPendingFiles = async (ctx: Context): Promise<void> => {
    const chatId = ctx.chat?.id
    if (!chatId) return
    const pendingFiles = drainPendingFilesForChat(chatId)
    for (const pending of pendingFiles) {
        try {
            const extension = path.extname(pending.filePath).toLowerCase()
            const isImage = imageExtensions.has(extension)
            const mode = pending.mode ?? 'auto'
            const sendAsPhoto = mode === 'photo' || (mode === 'auto' && isImage)

            if (sendAsPhoto) {
                await ctx.replyWithPhoto(new InputFile(pending.filePath), pending.caption ? { caption: pending.caption } : undefined)
            } else {
                await ctx.replyWithDocument(new InputFile(pending.filePath), pending.caption ? { caption: pending.caption } : undefined)
            }
        } catch (error) {
            console.error(`[telegram] failed to send queued file ${pending.filePath}:`, error)
        }
    }
}

const parseAllowedChatIds = (value: string | undefined): Set<string> => {
    if (!value) return new Set<string>()
    return new Set(
        value
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean)
    )
}

const accessControlMiddleware = (allowedChats: Set<string>) => {
    return async (ctx: Context, next: NextFunction): Promise<void> => {
        const chatId = String(ctx.chat?.id ?? '')
        if (!chatId) return
        if (!allowedChats.has(chatId)) {
            await ctx.reply('Access denied.')
            return
        }
        await next()
    }
}

const parseCronAddArgs = (input: string): { schedule: string; prompt: string } | null => {
    const trimmed = input.trim()
    if (!trimmed) return null

    if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
        const quote = trimmed[0]
        if (!quote) return null
        const closingIdx = trimmed.indexOf(quote, 1)
        if (closingIdx <= 1) return null
        const schedule = trimmed.slice(1, closingIdx).trim()
        const prompt = trimmed.slice(closingIdx + 1).trim()
        if (!schedule || !prompt) return null
        return { schedule, prompt }
    }

    const parts = trimmed.split(/\s+/)
    for (const cronFieldCount of [5, 6]) {
        if (parts.length <= cronFieldCount) continue
        const schedule = parts.slice(0, cronFieldCount).join(' ')
        const prompt = parts.slice(cronFieldCount).join(' ').trim()
        if (!prompt) continue
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

const parseRunArgs = (input: string): { agent: AgentName; task: string; workdir: string } | null => {
    const trimmed = input.trim()
    if (!trimmed) return null

    const [agentToken, ...restParts] = trimmed.split(/\s+/)
    if (!agentToken) return null
    if (agentToken !== 'codex' && agentToken !== 'opencode' && agentToken !== 'claude') return null

    const rest = restParts.join(' ').trim()
    const workdirRegex = /(?:^|\s)--workdir\s+("[^"]+"|'[^']+'|\S+)/g
    let workdir = Bun.env.HOME ?? process.env.HOME ?? os.homedir()
    let taskText = rest

    const matches = [...rest.matchAll(workdirRegex)]
    if (matches.length > 0) {
        const last = matches[matches.length - 1]
        const full = last?.[0] ?? ''
        const captured = last?.[1] ?? ''
        const normalized = captured.replace(/^['"]|['"]$/g, '').trim()
        if (normalized) workdir = normalized
        taskText = taskText.replace(full, ' ').replace(/\s+/g, ' ').trim()
    }

    if (!taskText) return null
    return { agent: agentToken, task: taskText, workdir }
}

const relativeTimeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

const formatRelativeTime = (dateIso: string): string => {
    const timestamp = Date.parse(dateIso)
    if (Number.isNaN(timestamp)) return dateIso
    const diffMs = timestamp - Date.now()
    const diffSeconds = Math.round(diffMs / 1000)
    if (Math.abs(diffSeconds) < 60) return relativeTimeFormat.format(diffSeconds, 'second')
    const diffMinutes = Math.round(diffSeconds / 60)
    if (Math.abs(diffMinutes) < 60) return relativeTimeFormat.format(diffMinutes, 'minute')
    const diffHours = Math.round(diffMinutes / 60)
    if (Math.abs(diffHours) < 24) return relativeTimeFormat.format(diffHours, 'hour')
    return relativeTimeFormat.format(Math.round(diffHours / 24), 'day')
}

const runCommand = async (cmd: string[], cwd: string): Promise<string> => {
    const proc = Bun.spawn(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
    const output = [stdout, stderr].filter(Boolean).join('\n').trim()
    if (exitCode !== 0) throw new Error(output || `Command failed: ${cmd.join(' ')}`)
    return output
}
