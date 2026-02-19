import { query } from '@anthropic-ai/claude-agent-sdk'
import { customMemoryTools } from './tools'
import { loadSession, saveSession, type SessionMessage } from './session'

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

const toSdkMessages = (messages: SessionMessage[]): Array<{ role: string; content: string }> =>
    messages.map((message) => ({ role: message.role, content: message.content }))

const extractText = (event: unknown): string => {
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

    // Assistant message content
    if (Array.isArray(e['content'])) {
        return e['content']
            .filter((b: unknown) => typeof b === 'object' && b !== null && (b as Record<string, unknown>)['type'] === 'text')
            .map((b: unknown) => (b as Record<string, unknown>)['text'] as string)
            .join('')
    }

    return ''
}

export const runAgent = async (chatId: string, messageText: string, onChunk?: OnChunk): Promise<string> => {
    console.log(`[agent] runAgent — chatId: ${chatId}, message: "${messageText.slice(0, 80)}"`)

    const session = await loadSession(chatId)
    console.log(`[agent] loaded session — ${session.length} messages`)

    const userMessage: SessionMessage = { role: 'user', content: messageText, timestamp: nowIso() }
    const draftSession = [...session, userMessage]
    let finalText = ''

    try {
        console.log('[agent] calling query()...')

        const response = await query({
            prompt: messageText,
            systemPrompt: systemPrompt(),
            messageHistory: toSdkMessages(draftSession),
            tools: [...BUILTIN_TOOLS, ...customMemoryTools] as unknown,
            permissionMode: 'bypassPermissions',
            options: { stream: true }
        } as never)

        console.log('[agent] query() returned, iterating events...')

        let eventCount = 0
        for await (const event of response as AsyncIterable<unknown>) {
            eventCount++
            const e = event as Record<string, unknown>

            // Log every event type so we can see what the SDK actually emits
            console.log(`[agent] event #${eventCount}:`, JSON.stringify(e).slice(0, 200))

            const chunk = extractText(event)
            if (!chunk) continue

            finalText += chunk
            if (onChunk) await onChunk(finalText)
        }

        console.log(`[agent] done — ${eventCount} events, finalText length: ${finalText.length}`)

        if (!finalText.trim()) {
            console.warn('[agent] finalText is empty — no text extracted from any event')
            finalText = 'I could not generate a response.'
        }

        const assistantMessage: SessionMessage = { role: 'assistant', content: finalText, timestamp: nowIso() }
        await saveSession(chatId, [...draftSession, assistantMessage])
        return finalText
    } catch (error) {
        console.error('[agent] query() threw an error:', error)
        await saveSession(chatId, draftSession)
        throw error
    }
}
