import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk'
import type { Api } from 'grammy'
import { InlineKeyboard } from 'grammy'
import type { CallbackQuery } from 'grammy/types'

const AUTO_ALLOW_TOOLS = new Set(['Read', 'Glob', 'Grep', 'WebFetch'])

const shouldAutoAllow = (toolName: string): boolean => {
    if (AUTO_ALLOW_TOOLS.has(toolName)) return true
    // Auto-allow MCP tools from the jellyfish-memory server (internal tools)
    if (toolName.startsWith('mcp__jellyfish-memory__')) return true
    return false
}
const TIMEOUT_MS = 2 * 60 * 1000

interface PendingRequest {
    resolve: (result: { behavior: 'allow' } | { behavior: 'deny'; message: string }) => void
    timer: ReturnType<typeof setTimeout>
    chatId: number
    messageId: number
}

const pendingRequests = new Map<string, PendingRequest>()

const summarizeInput = (toolName: string, input: Record<string, unknown>): string => {
    if (toolName === 'Bash' && typeof input['command'] === 'string') {
        return input['command'].slice(0, 300)
    }
    if ((toolName === 'Write' || toolName === 'Edit') && typeof input['file_path'] === 'string') {
        return input['file_path']
    }
    if (toolName === 'Skill' && typeof input['skill'] === 'string') {
        return `/${input['skill']}${typeof input['args'] === 'string' ? ` ${input['args']}` : ''}`
    }
    const json = JSON.stringify(input)
    return json.length > 300 ? `${json.slice(0, 297)}...` : json
}

export const createCanUseTool = (botApi: Api, chatId: number): CanUseTool => {
    return async (toolName, input, options) => {
        if (shouldAutoAllow(toolName)) {
            return { behavior: 'allow' }
        }

        const requestId = `perm:${options.toolUseID}`
        const summary = summarizeInput(toolName, input)

        const keyboard = new InlineKeyboard().text('✅ Allow', `${requestId}:allow`).text('❌ Deny', `${requestId}:deny`)

        const text = `🔐 Permission Request\nTool: ${toolName}\n${summary}`

        const sent = await botApi.sendMessage(chatId, text, { reply_markup: keyboard })

        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                pendingRequests.delete(requestId)
                void botApi.editMessageText(chatId, sent.message_id, `${text}\n\n⏰ Timed out — denied`).catch(() => {})
                resolve({ behavior: 'deny', message: 'Permission request timed out' })
            }, TIMEOUT_MS)

            pendingRequests.set(requestId, {
                resolve,
                timer,
                chatId,
                messageId: sent.message_id
            })
        })
    }
}

export const handlePermissionCallback = async (botApi: Api, callbackQuery: CallbackQuery & { data: string }): Promise<boolean> => {
    const data = callbackQuery.data
    if (!data.startsWith('perm:')) return false

    const lastColon = data.lastIndexOf(':')
    const requestId = data.slice(0, lastColon)
    const decision = data.slice(lastColon + 1)

    const pending = pendingRequests.get(requestId)
    if (!pending) {
        await botApi.answerCallbackQuery(callbackQuery.id, { text: 'Request expired' }).catch(() => {})
        return true
    }

    clearTimeout(pending.timer)
    pendingRequests.delete(requestId)

    const allowed = decision === 'allow'
    const label = allowed ? '✅ Allowed' : '❌ Denied'

    await botApi.editMessageText(pending.chatId, pending.messageId, `${callbackQuery.message?.text ?? 'Permission Request'}\n\n${label}`).catch(() => {})
    await botApi.answerCallbackQuery(callbackQuery.id, { text: label }).catch(() => {})

    if (allowed) {
        pending.resolve({ behavior: 'allow' })
    } else {
        pending.resolve({ behavior: 'deny', message: 'User denied permission' })
    }

    return true
}
