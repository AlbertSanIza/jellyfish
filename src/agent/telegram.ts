import type { CanUseTool, SDKSessionInfo } from '@anthropic-ai/claude-agent-sdk'
import { listSessions } from '@anthropic-ai/claude-agent-sdk'
import { Bot, Context, InlineKeyboard, type Filter, type NextFunction } from 'grammy'

import { run } from './agent'
import { clearSession, loadSession, saveSession } from './session'
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

    bot.on('callback_query:data', async (ctx) => {
        const data = ctx.callbackQuery.data
        console.log(`[callback] received callback_query data: "${data}"`)

        if (data.startsWith('sess:')) {
            await handleSessionCallback(ctx, data)
            return
        }

        console.log(`[callback] pending keys at time of callback: ${[...pendingRequests.keys()].join(', ') || '(empty)'}`)

        if (!data.startsWith('perm:')) {
            console.log(`[callback] unknown callback data, ignoring`)
            await ctx.answerCallbackQuery()
            return
        }

        const lastColon = data.lastIndexOf(':')
        const requestId = data.slice(0, lastColon)
        const decision = data.slice(lastColon + 1)
        console.log(`[callback] parsed — requestId: "${requestId}", decision: "${decision}"`)

        const pending = pendingRequests.get(requestId)
        if (!pending) {
            console.log(`[callback] NO pending request found for requestId: "${requestId}"`)
            await ctx.answerCallbackQuery({ text: 'Request expired' }).catch(() => {})
            return
        }

        console.log(`[callback] found pending request — tool: ${pending.toolName}, chatId: ${pending.chatId}`)
        clearTimeout(pending.timer)
        pendingRequests.delete(requestId)

        const allowed = decision === 'allow' || decision === 'always'
        const label = allowed ? (decision === 'always' ? '✅ Always Allowed' : '✅ Allowed') : '❌ Denied'
        console.log(`[callback] decision: ${decision}, allowed: ${allowed}, label: ${label}`)

        if (decision === 'always') {
            let chatSet = alwaysAllowedByChat.get(pending.chatId)
            if (!chatSet) {
                chatSet = new Set()
                alwaysAllowedByChat.set(pending.chatId, chatSet)
            }
            chatSet.add(pending.toolName)
            console.log(`[callback] added "${pending.toolName}" to always-allowed for chat ${pending.chatId}`)
        }

        await bot.api
            .editMessageText(pending.chatId, pending.messageId, `${ctx.callbackQuery.message?.text ?? 'Permission Request'}\n\n${label}`)
            .catch((e) => console.log(`[callback] editMessageText error:`, e))
        await ctx.answerCallbackQuery({ text: label }).catch((e) => console.log(`[callback] answerCallbackQuery error:`, e))

        console.log(`[callback] resolving promise with behavior: ${allowed ? 'allow' : 'deny'}`)
        if (allowed) {
            pending.resolve({ behavior: 'allow', updatedInput: pending.input })
        } else {
            pending.resolve({ behavior: 'deny', message: 'User denied permission' })
        }
        console.log(`[callback] done`)
    })

    bot.on('message', async (ctx) => {
        const stopProcessing = startProcessing(ctx)
        try {
            const chatId = ctx.chat.id
            const session = await loadSession(chatId)
            const canUseTool = createCanUseTool(bot.api, chatId)
            const result = await run(ctx.message.text || '', canUseTool, session.sdkSessionId)
            await saveSession(chatId, { sdkSessionId: result.sessionId, messages: [] })
            await sendFormattedReply(ctx, result.text)
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

const AUTO_ALLOW_TOOLS = new Set(['Read', 'Glob', 'Grep', 'WebFetch'])
const TIMEOUT_MS = 2 * 60 * 1000
const sessionMenuCache = new Map<number, SDKSessionInfo[]>()

interface PendingRequest {
    resolve: (result: { behavior: 'allow'; updatedInput: Record<string, unknown> } | { behavior: 'deny'; message: string }) => void
    timer: ReturnType<typeof setTimeout>
    chatId: number
    messageId: number
    toolName: string
    input: Record<string, unknown>
}

const pendingRequests = new Map<string, PendingRequest>()
const alwaysAllowedByChat = new Map<number, Set<string>>()

function createCanUseTool(botApi: Bot['api'], chatId: number): CanUseTool {
    return async (toolName, input, options) => {
        console.log(`[canUseTool] called — tool: ${toolName}, toolUseID: ${options.toolUseID}`)
        if (AUTO_ALLOW_TOOLS.has(toolName)) {
            console.log(`[canUseTool] auto-allowing ${toolName}`)
            return { behavior: 'allow', updatedInput: input }
        }
        const requestId = `perm:${options.toolUseID}`
        console.log(`[canUseTool] requestId: ${requestId}`)
        const summary = summarizeInput(toolName, input)
        const text = `🔐 Permission Request\nTool: ${toolName}\n${summary}`

        const keyboard = new InlineKeyboard()
            .text('✅ Allow', `${requestId}:allow`)
            .text('✅ Always Allow', `${requestId}:always`)
            .text('❌ Deny', `${requestId}:deny`)

        console.log(`[canUseTool] callback_data values: "${requestId}:allow", "${requestId}:always", "${requestId}:deny"`)
        console.log(`[canUseTool] callback_data length: ${`${requestId}:always`.length} chars`)

        const sent = await botApi.sendMessage(chatId, text, { reply_markup: keyboard })
        console.log(`[canUseTool] permission message sent, messageId: ${sent.message_id}`)

        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                console.log(`[canUseTool] TIMEOUT for requestId: ${requestId}`)
                pendingRequests.delete(requestId)
                void botApi.editMessageText(chatId, sent.message_id, `${text}\n\n⏰ Timed out — denied`).catch(() => {})
                resolve({ behavior: 'deny', message: 'Permission request timed out' })
            }, TIMEOUT_MS)

            pendingRequests.set(requestId, { resolve, timer, chatId, messageId: sent.message_id, toolName, input })
            console.log(`[canUseTool] pending request stored. Map size: ${pendingRequests.size}`)
            console.log(`[canUseTool] pending keys: ${[...pendingRequests.keys()].join(', ')}`)
        })
    }
}

function summarizeInput(toolName: string, input: Record<string, unknown>): string {
    if (toolName === 'Bash' && typeof input['command'] === 'string') return input['command'].slice(0, 300)
    if ((toolName === 'Write' || toolName === 'Edit') && typeof input['file_path'] === 'string') return input['file_path']
    const json = JSON.stringify(input)
    return json.length > 300 ? `${json.slice(0, 297)}...` : json
}

async function handleSessionCallback(ctx: Filter<Context, 'callback_query:data'>, data: string): Promise<void> {
    const chatId = ctx.callbackQuery.message?.chat?.id
    if (!chatId) {
        await ctx.answerCallbackQuery({ text: 'Error: no chat context' })
        return
    }

    await ctx.answerCallbackQuery()

    if (data === 'sess:cancel') {
        await ctx.deleteMessage().catch(() => {})
        return
    }

    if (data === 'sess:menu') {
        const keyboard = new InlineKeyboard()
            .text('📋 Details', 'sess:details')
            .text('🔄 Resume', 'sess:resume')
            .row()
            .text('🗑 Remove', 'sess:remove')
            .text('❌ Cancel', 'sess:cancel')
        await ctx.editMessageText('🪼 Session Manager', { reply_markup: keyboard })
        return
    }

    if (data === 'sess:details') {
        const session = await loadSession(chatId)
        const id = session.sdkSessionId ?? 'None'
        const shortId = id.length > 12 ? `${id.slice(0, 12)}...` : id
        let text = `📋 Current Session\n\nSession: ${shortId}`

        if (session.sdkSessionId) {
            const sdkSessions = await listSessions({ dir: process.cwd() })
            const match = sdkSessions.find((s) => s.sessionId === session.sdkSessionId)
            if (match) {
                if (match.gitBranch) text += `\nBranch: ${match.gitBranch}`
                if (match.summary) text += `\nSummary: ${match.summary.slice(0, 100)}`
            }
        }

        const keyboard = new InlineKeyboard().text('⬅️ Back', 'sess:menu')
        await ctx.editMessageText(text, { reply_markup: keyboard })
        return
    }

    if (data === 'sess:resume') {
        const sdkSessions = await listSessions({ dir: process.cwd(), limit: 5 })
        sessionMenuCache.set(chatId, sdkSessions)

        if (!sdkSessions.length) {
            const keyboard = new InlineKeyboard().text('⬅️ Back', 'sess:menu')
            await ctx.editMessageText('🔄 No sessions available to resume.', { reply_markup: keyboard })
            return
        }

        const session = await loadSession(chatId)
        const keyboard = new InlineKeyboard()
        for (let i = 0; i < sdkSessions.length; i++) {
            const s = sdkSessions[i]
            const label = s.summary?.slice(0, 30) || s.sessionId.slice(0, 12)
            const active = s.sessionId === session.sdkSessionId ? ' ✓' : ''
            keyboard.text(`${i + 1}. ${label}${active}`, `sess:r:${i}`).row()
        }
        keyboard.text('⬅️ Back', 'sess:menu')

        await ctx.editMessageText('🔄 Pick a session to resume:', { reply_markup: keyboard })
        return
    }

    if (data === 'sess:remove') {
        const session = await loadSession(chatId)
        const sdkSessions = (await listSessions({ dir: process.cwd(), limit: 6 })).filter((s) => s.sessionId !== session.sdkSessionId)
        sessionMenuCache.set(chatId, sdkSessions)

        if (!sdkSessions.length) {
            const keyboard = new InlineKeyboard().text('⬅️ Back', 'sess:menu')
            await ctx.editMessageText('🗑 No other sessions to remove.', { reply_markup: keyboard })
            return
        }

        const keyboard = new InlineKeyboard()
        for (let i = 0; i < Math.min(sdkSessions.length, 5); i++) {
            const s = sdkSessions[i]
            const label = s.summary?.slice(0, 30) || s.sessionId.slice(0, 12)
            keyboard.text(`${i + 1}. ${label}`, `sess:x:${i}`).row()
        }
        keyboard.text('⬅️ Back', 'sess:menu')

        await ctx.editMessageText('🗑 Pick a session to remove:', { reply_markup: keyboard })
        return
    }

    if (data.startsWith('sess:r:')) {
        const index = parseInt(data.slice(7), 10)
        const cached = sessionMenuCache.get(chatId)
        if (!cached || index < 0 || index >= cached.length) {
            const keyboard = new InlineKeyboard().text('⬅️ Back', 'sess:menu')
            await ctx.editMessageText('Session not found. Try again.', { reply_markup: keyboard })
            return
        }

        const picked = cached[index]
        await saveSession(chatId, { sdkSessionId: picked.sessionId, messages: [] })

        const keyboard = new InlineKeyboard().text('⬅️ Back', 'sess:menu')
        await ctx.editMessageText(`✅ Resumed session:\n${picked.summary?.slice(0, 60) || picked.sessionId.slice(0, 12)}`, { reply_markup: keyboard })
        return
    }

    if (data.startsWith('sess:x:')) {
        const index = parseInt(data.slice(7), 10)
        const cached = sessionMenuCache.get(chatId)
        if (!cached || index < 0 || index >= cached.length) {
            const keyboard = new InlineKeyboard().text('⬅️ Back', 'sess:menu')
            await ctx.editMessageText('Session not found. Try again.', { reply_markup: keyboard })
            return
        }

        const picked = cached[index]
        const session = await loadSession(chatId)
        if (session.sdkSessionId === picked.sessionId) {
            await clearSession(chatId)
        }

        const keyboard = new InlineKeyboard().text('⬅️ Back', 'sess:menu')
        await ctx.editMessageText(`🗑 Removed association:\n${picked.summary?.slice(0, 60) || picked.sessionId.slice(0, 12)}`, { reply_markup: keyboard })
        return
    }
}
