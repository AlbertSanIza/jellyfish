import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { lstat, mkdir, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import telegramifyMarkdown from 'telegramify-markdown'

import { loadSession, saveSession, type SessionData, type SessionMessage } from './session'
import { createJellyfishMcpServer } from './tools'

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
    sonnet: 'claude-sonnet-4-6',
    opus: 'claude-opus-4-6',
    // Prefer account default for "haiku" shorthand to avoid stale model IDs.
    haiku: ''
}

const getModel = (): string | undefined => {
    const modelEnv = Bun.env.CLAUDE_MODEL
    if (!modelEnv) return undefined
    const resolved = MODEL_ALIASES[modelEnv.toLowerCase()] ?? modelEnv
    return resolved.trim() ? resolved : undefined
}

interface QueryAttemptOptions {
    label: string
    resumeSessionId?: string
    includePartialMessages: boolean
    includeMemoryMcp: boolean
    includeBuiltinTools: boolean
    bypassPermissions: boolean
    model?: string
}

interface QueryExecutionResult {
    sessionId?: string
    accumulatedText: string
    finalResult?: string
}

const isClaudeProcessExitError = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error)
    return message.includes('Claude Code process exited with code')
}

const getErrorSummary = (error: unknown): string => {
    const message = error instanceof Error ? error.message : String(error)
    return message.replace(/\s+/g, ' ').trim().slice(0, 220)
}

const ensureProjectSkillsBridge = async (): Promise<void> => {
    const projectSkillsDir = path.join(process.cwd(), 'skills')
    const claudeProjectDir = path.join(process.cwd(), '.claude')
    const claudeSkillsDir = path.join(claudeProjectDir, 'skills')

    try {
        const srcStat = await lstat(projectSkillsDir)
        if (!srcStat.isDirectory()) return
    } catch {
        return
    }

    try {
        const existing = await lstat(claudeSkillsDir)
        if (existing.isDirectory() || existing.isSymbolicLink()) return
    } catch {
        await mkdir(claudeProjectDir, { recursive: true })
        try {
            await symlink(projectSkillsDir, claudeSkillsDir, 'dir')
        } catch (error) {
            console.warn('[agent] could not create .claude/skills symlink:', error)
        }
    }
}

const prepareClaudeRuntimeEnv = async (): Promise<void> => {
    if (process.env.DEBUG_CLAUDE_AGENT_SDK) {
        console.warn('[agent] DEBUG_CLAUDE_AGENT_SDK is enabled; disabling for bot runtime')
        delete process.env.DEBUG_CLAUDE_AGENT_SDK
    }

    const debugDir = path.join(process.cwd(), '.jellyfish', 'claude-debug')
    try {
        await mkdir(debugDir, { recursive: true })
        // SDK expects a file path here, not a directory path.
        process.env.CLAUDE_CODE_DEBUG_LOGS_DIR = path.join(debugDir, 'sdk.log')
    } catch {
        // Ignore debug dir setup failures; SDK can still run without this override.
    }

    await ensureProjectSkillsBridge()
}

const executeQueryAttempt = async (
    messageText: string,
    onChunk: OnChunk | undefined,
    options: QueryAttemptOptions,
    mcpServer: ReturnType<typeof createJellyfishMcpServer>
): Promise<QueryExecutionResult> => {
    let capturedSessionId = options.resumeSessionId
    let accumulatedText = ''
    let finalResult: string | undefined

    const response = query({
        prompt: messageText,
        options: {
            systemPrompt: buildSystemPrompt(),
            tools: options.includeBuiltinTools ? BUILTIN_TOOLS : [],
            ...(options.bypassPermissions ? { permissionMode: 'bypassPermissions' as const, allowDangerouslySkipPermissions: true } : {}),
            includePartialMessages: options.includePartialMessages,
            cwd: process.cwd(),
            additionalDirectories: [os.homedir()],
            ...(options.includeMemoryMcp
                ? {
                      mcpServers: {
                          'jellyfish-memory': mcpServer
                      }
                  }
                : {}),
            ...(options.model ? { model: options.model } : {}),
            settingSources: ['user', 'project', 'local'],
            ...(options.resumeSessionId ? { resume: options.resumeSessionId } : {})
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
            if (onChunk) await onChunk(telegramifyMarkdown(accumulatedText, 'escape'))
        }

        const result = extractFinalText(event)
        if (result !== undefined) {
            finalResult = result
        }
    }

    console.log(`[agent] done — ${eventCount} events, accumulated: ${accumulatedText.length} chars`)

    return { sessionId: capturedSessionId, accumulatedText, finalResult }
}

export const runAgent = async (chatId: number, messageText: string, onChunk?: OnChunk): Promise<string> => {
    console.log(`[agent] chatId: ${chatId} | message: "${messageText.slice(0, 80)}"`)
    await prepareClaudeRuntimeEnv()

    const session = await loadSession(chatId)
    console.log(`[agent] session — ${session.messages.length} messages, sdkSessionId: ${session.sdkSessionId ?? 'none'}`)

    const userMessage: SessionMessage = { role: 'user', content: messageText, timestamp: nowIso() }
    let capturedSessionId: string | undefined = session.sdkSessionId
    const configuredModel = getModel()
    const mcpServer = createJellyfishMcpServer(chatId)

    try {
        const attempts: QueryAttemptOptions[] = [
            {
                label: 'resume/full',
                resumeSessionId: session.sdkSessionId,
                includePartialMessages: true,
                includeMemoryMcp: true,
                includeBuiltinTools: true,
                bypassPermissions: true,
                model: configuredModel
            },
            {
                label: 'fresh/full',
                includePartialMessages: true,
                includeMemoryMcp: true,
                includeBuiltinTools: true,
                bypassPermissions: true,
                model: configuredModel
            },
            {
                label: 'fresh/full/default-model',
                includePartialMessages: true,
                includeMemoryMcp: true,
                includeBuiltinTools: true,
                bypassPermissions: true
            },
            {
                label: 'fresh/no-mcp-no-partials',
                includePartialMessages: false,
                includeMemoryMcp: false,
                includeBuiltinTools: true,
                bypassPermissions: true
            },
            {
                label: 'fresh/minimal',
                includePartialMessages: false,
                includeMemoryMcp: false,
                includeBuiltinTools: false,
                bypassPermissions: true
            },
            {
                label: 'fresh/minimal/default-permissions',
                includePartialMessages: false,
                includeMemoryMcp: false,
                includeBuiltinTools: false,
                bypassPermissions: false
            }
        ]

        let lastProcessExitError: unknown
        let sawNonCrashFailure = false

        for (const attempt of attempts) {
            try {
                console.log(`[agent] attempt ${attempt.label}`)
                const execution = await executeQueryAttempt(messageText, onChunk, attempt, mcpServer)
                const rawText = execution.finalResult ?? execution.accumulatedText
                capturedSessionId = execution.sessionId

                if (!rawText.trim()) {
                    console.warn(`[agent] empty response on attempt ${attempt.label}`)
                    sawNonCrashFailure = true
                    continue
                }

                const updatedData: SessionData = {
                    sdkSessionId: capturedSessionId,
                    messages: [...session.messages, userMessage, { role: 'assistant', content: rawText, timestamp: nowIso() }]
                }
                await saveSession(chatId, updatedData)

                return telegramifyMarkdown(rawText, 'escape')
            } catch (error) {
                if (!isClaudeProcessExitError(error)) throw error
                lastProcessExitError = error
                console.warn(`[agent] process exit on attempt ${attempt.label}: ${getErrorSummary(error)}`)
            }
        }

        if (lastProcessExitError && !sawNonCrashFailure) {
            throw new Error('Claude Code process exited repeatedly. Please try again in a minute.')
        }
        return 'I could not generate a response right now. Please try again.'
    } catch (error) {
        console.error('[agent] error:', error)
        const keepSessionId = isClaudeProcessExitError(error) ? undefined : capturedSessionId
        await saveSession(chatId, { sdkSessionId: keepSessionId, messages: [...session.messages, userMessage] })
        throw error
    }
}
