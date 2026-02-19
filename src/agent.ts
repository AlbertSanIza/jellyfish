import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import os from 'node:os'
import { markdownToHtml } from './format'
import { memoryMcpServer } from './tools'
import { loadSession, saveSession, type SessionData, type SessionMessage } from './session'

type OnChunk = (partialText: string) => Promise<void> | void

const BUILTIN_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebFetch']

const nowIso = (): string => new Date().toISOString()

const buildSystemPrompt = (): string => {
    const now = new Date()
    return [
        'You are Jellyfish, a helpful personal AI assistant for Telegram.',
        'Be concise, useful, and proactive.',
        `Current date/time: ${now.toISOString()} (${now.toString()})`
    ].join('\n')
}

const extractTextDelta = (event: SDKMessage): string => {
    // Streaming partial assistant message — dig into the raw Anthropic stream event
    if (event.type === 'stream_event') {
        const e = event.event as Record<string, unknown>
        if (e['type'] === 'content_block_delta') {
            const delta = e['delta'] as Record<string, unknown>
            if (delta['type'] === 'text_delta' && typeof delta['text'] === 'string') {
                return delta['text']
            }
        }
    }
    return ''
}

const extractSessionId = (event: SDKMessage): string | undefined => {
    if (event.type === 'system' && event.subtype === 'init') {
        return event.session_id
    }
    return undefined
}

const extractFinalText = (event: SDKMessage): string | undefined => {
    if (event.type === 'result' && event.subtype === 'success') {
        return event.result
    }
    return undefined
}

const MODEL_ALIASES: Record<string, string> = {
    sonnet: 'claude-sonnet-4-20250514',
    opus: 'claude-opus-4-6',
    haiku: 'claude-haiku-4-20250514'
}

const getModel = (): string | undefined => {
    const modelEnv = Bun.env.CLAUDE_MODEL
    if (!modelEnv) return undefined
    return MODEL_ALIASES[modelEnv.toLowerCase()] ?? modelEnv
}

export const runAgent = async (chatId: string, messageText: string, onChunk?: OnChunk): Promise<string> => {
    console.log(`[agent] chatId: ${chatId} | message: "${messageText.slice(0, 80)}"`)

    const session = await loadSession(chatId)
    console.log(`[agent] session — ${session.messages.length} messages, sdkSessionId: ${session.sdkSessionId ?? 'none'}`)

    const userMessage: SessionMessage = { role: 'user', content: messageText, timestamp: nowIso() }
    let capturedSessionId: string | undefined = session.sdkSessionId
    let accumulatedText = ''
    let finalResult: string | undefined

    try {
        const model = getModel()
        console.log(
            `[agent] calling query()${session.sdkSessionId ? ` (resuming ${session.sdkSessionId})` : ' (new session)'}${model ? ` | model: ${model}` : ''}`
        )

        const response = query({
            prompt: messageText,
            options: {
                systemPrompt: buildSystemPrompt(),
                tools: BUILTIN_TOOLS,
                permissionMode: 'bypassPermissions',
                allowDangerouslySkipPermissions: true,
                includePartialMessages: true,
                cwd: process.cwd(),
                additionalDirectories: [os.homedir()],
                mcpServers: {
                    'jellyfish-memory': memoryMcpServer
                },
                ...(model ? { model } : {}),
                ...(session.sdkSessionId ? { resume: session.sdkSessionId } : {})
            }
        })

        let eventCount = 0

        for await (const event of response) {
            eventCount++

            const sid = extractSessionId(event)
            if (sid) {
                capturedSessionId = sid
                console.log(`[agent] sdkSessionId: ${sid}`)
            }

            const delta = extractTextDelta(event)
            if (delta) {
                accumulatedText += delta
                if (onChunk) await onChunk(markdownToHtml(accumulatedText))
            }

            const result = extractFinalText(event)
            if (result !== undefined) {
                finalResult = result
            }
        }

        console.log(`[agent] done — ${eventCount} events, accumulated: ${accumulatedText.length} chars`)

        // Prefer the SDK's authoritative result string; fall back to accumulated deltas
        const rawText = finalResult ?? accumulatedText

        if (!rawText.trim()) {
            console.warn('[agent] empty response from SDK')
            return 'I could not generate a response.'
        }

        const updatedData: SessionData = {
            sdkSessionId: capturedSessionId,
            messages: [...session.messages, userMessage, { role: 'assistant', content: rawText, timestamp: nowIso() }]
        }
        await saveSession(chatId, updatedData)

        return markdownToHtml(rawText)
    } catch (error) {
        console.error('[agent] error:', error)
        await saveSession(chatId, { sdkSessionId: capturedSessionId, messages: [...session.messages, userMessage] })
        throw error
    }
}
