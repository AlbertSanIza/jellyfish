import { query } from '@anthropic-ai/claude-agent-sdk'
import { markdownToHtml } from './format'
import { customMemoryTools } from './tools'
import { loadSession, saveSession, type SessionData, type SessionMessage } from './session'

type OnChunk = (partialText: string) => Promise<void> | void

const BUILTIN_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebFetch'] as const

const nowIso = (): string => new Date().toISOString()

const systemPrompt = (): string => {
    const now = new Date()
    return [
        'You are Jellyfish, a helpful personal AI assistant for Telegram.',
        'Be concise, useful, and proactive.',
        `Current date/time: ${now.toISOString()} (${now.toString()})`
    ].join('\n')
}

const extractTextFromEvent = (event: unknown): string => {
    if (typeof event !== 'object' || event === null) return ''
    const e = event as Record<string, unknown>

    // Final result message from the SDK
    if (typeof e['result'] === 'string') return e['result']

    // Streaming text delta
    if (typeof e['text'] === 'string') return e['text']
    if (typeof e['delta'] === 'object' && e['delta'] !== null) {
        const delta = e['delta'] as Record<string, unknown>
        if (typeof delta['text'] === 'string') return delta['text']
    }

    // Assistant message with content blocks
    if (Array.isArray(e['content'])) {
        return e['content']
            .filter((b: unknown) => typeof b === 'object' && b !== null && (b as Record<string, unknown>)['type'] === 'text')
            .map((b: unknown) => (b as Record<string, unknown>)['text'] as string)
            .join('')
    }

    return ''
}

const extractSdkSessionId = (event: unknown): string | undefined => {
    if (typeof event !== 'object' || event === null) return undefined
    const e = event as Record<string, unknown>
    // SDK emits { type: "system", subtype: "init", session_id: "..." } as the first event
    if (e['type'] === 'system' && e['subtype'] === 'init' && typeof e['session_id'] === 'string') {
        return e['session_id']
    }
    return undefined
}

export const runAgent = async (chatId: string, messageText: string, onChunk?: OnChunk): Promise<string> => {
    console.log(`[agent] chatId: ${chatId} | message: "${messageText.slice(0, 80)}"`)

    const session = await loadSession(chatId)
    console.log(`[agent] session — ${session.messages.length} messages, sdkSessionId: ${session.sdkSessionId ?? 'none'}`)

    const userMessage: SessionMessage = { role: 'user', content: messageText, timestamp: nowIso() }
    let capturedSdkSessionId: string | undefined = session.sdkSessionId
    let rawText = ''

    try {
        // Build query options — resume existing SDK session if we have one
        const queryOptions = {
            prompt: messageText,
            systemPrompt: systemPrompt(),
            tools: [...BUILTIN_TOOLS, ...customMemoryTools] as unknown,
            permissionMode: 'bypassPermissions' as const,
            options: {
                stream: true,
                ...(session.sdkSessionId ? { resume: session.sdkSessionId } : {})
            }
        }

        console.log(`[agent] calling query()${session.sdkSessionId ? ` (resuming ${session.sdkSessionId})` : ' (new session)'}`)

        const response = await query(queryOptions as never)
        let eventCount = 0

        for await (const event of response as AsyncIterable<unknown>) {
            eventCount++

            // Capture SDK session ID from the init event
            const sid = extractSdkSessionId(event)
            if (sid) {
                capturedSdkSessionId = sid
                console.log(`[agent] captured sdkSessionId: ${sid}`)
            }

            const chunk = extractTextFromEvent(event)
            if (!chunk) continue

            rawText += chunk
            if (onChunk) await onChunk(markdownToHtml(rawText))
        }

        console.log(`[agent] done — ${eventCount} events, response length: ${rawText.length}`)

        if (!rawText.trim()) {
            console.warn('[agent] empty response from SDK')
            return 'I could not generate a response.'
        }

        // Persist session — append both user and assistant messages
        const updatedData: SessionData = {
            sdkSessionId: capturedSdkSessionId,
            messages: [...session.messages, userMessage, { role: 'assistant', content: rawText, timestamp: nowIso() }]
        }
        await saveSession(chatId, updatedData)

        return markdownToHtml(rawText)
    } catch (error) {
        console.error('[agent] error:', error)
        // Still save the user message so context isn't lost
        await saveSession(chatId, { sdkSessionId: capturedSdkSessionId, messages: [...session.messages, userMessage] })
        throw error
    }
}
