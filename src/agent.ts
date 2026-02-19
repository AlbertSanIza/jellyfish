import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { lstat, mkdir, readFile, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import telegramifyMarkdown from 'telegramify-markdown'

import { loadSession, saveSession, type SessionData, type SessionMessage } from './session'
import { createJellyfishMcpServer } from './tools'

type OnChunk = (partialText: string) => Promise<void> | void

const BUILTIN_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebFetch']
const SKILL_TOOL = 'Skill'

const nowIso = (): string => new Date().toISOString()

interface ProjectSkill {
    name: string
    path: string
}

const buildSystemPrompt = (availableSkills: ProjectSkill[] = []): string => {
    const now = new Date()
    const lines = [
        'You are Jellyfish, a helpful personal AI assistant for Telegram.',
        'Be concise, useful, and proactive.',
        `Current date/time: ${now.toISOString()} (${now.toString()})`
    ]

    if (availableSkills.length > 0) {
        lines.push(`Project skills available: ${availableSkills.map((skill) => `/${skill.name}`).join(', ')}`)
        lines.push('Skill file locations:')
        for (const skill of availableSkills) {
            lines.push(`- /${skill.name} => ${skill.path}`)
        }
        lines.push('When a user asks about a known skill/domain, prefer using the matching skill rather than saying you are unaware.')
        lines.push('If a skill is relevant, use the Read tool on its SKILL.md path before answering to ground your response.')
    }

    return lines.join('\n')
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

const parseSkillNameFromMarkdown = (content: string): string | undefined => {
    const trimmed = content.trimStart()
    if (!trimmed.startsWith('---')) return undefined

    const end = trimmed.indexOf('\n---', 3)
    if (end === -1) return undefined
    const frontmatter = trimmed.slice(3, end)
    const match = frontmatter.match(/^\s*name\s*:\s*(.+)\s*$/m)
    if (!match?.[1]) return undefined
    return match[1].trim().replace(/^['"]|['"]$/g, '')
}

const discoverProjectSkills = async (): Promise<ProjectSkill[]> => {
    const projectSkillsDir = path.join(process.cwd(), '.claude', 'skills')
    try {
        const entries = await readdir(projectSkillsDir, { withFileTypes: true })
        const skills: ProjectSkill[] = []

        for (const entry of entries) {
            if (!entry.isDirectory()) continue
            const skillPath = path.join(projectSkillsDir, entry.name, 'SKILL.md')
            try {
                const content = await readFile(skillPath, 'utf8')
                const parsed = parseSkillNameFromMarkdown(content)
                if (parsed) skills.push({ name: parsed, path: skillPath })
            } catch {
                // Ignore invalid skill folders in discovery.
            }
        }
        return skills
    } catch {
        return []
    }
}

const logSkillDiagnostics = async (): Promise<void> => {
    const projectSkillsDir = path.join(process.cwd(), '.claude', 'skills')

    try {
        const projectSkillsStat = await lstat(projectSkillsDir)
        console.log(`[agent] skills dir: ${projectSkillsDir} (${projectSkillsStat.isDirectory() ? 'directory' : 'not-directory'})`)
    } catch {
        console.log(`[agent] skills dir missing: ${projectSkillsDir}`)
        return
    }

    try {
        const entries = await readdir(projectSkillsDir, { withFileTypes: true })
        const skillDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
        if (skillDirs.length === 0) {
            console.log('[agent] no skill folders found under project skills/')
            return
        }

        for (const dir of skillDirs) {
            const skillPath = path.join(projectSkillsDir, dir, 'SKILL.md')
            try {
                const content = await readFile(skillPath, 'utf8')
                const parsedName = parseSkillNameFromMarkdown(content) ?? '(no frontmatter name)'
                console.log(`[agent] detected skill folder="${dir}" name="${parsedName}" file=${skillPath}`)
            } catch {
                console.warn(`[agent] skill folder missing SKILL.md: ${path.join(projectSkillsDir, dir)}`)
            }
        }
    } catch (error) {
        console.warn('[agent] failed to enumerate project skills:', error)
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

    await logSkillDiagnostics()
}

const executeQueryAttempt = async (
    messageText: string,
    onChunk: OnChunk | undefined,
    options: QueryAttemptOptions,
    mcpServer: ReturnType<typeof createJellyfishMcpServer>,
    availableSkills: ProjectSkill[]
): Promise<QueryExecutionResult> => {
    let capturedSessionId = options.resumeSessionId
    let accumulatedText = ''
    let finalResult: string | undefined
    const allowedTools = options.includeBuiltinTools ? [SKILL_TOOL, ...BUILTIN_TOOLS] : [SKILL_TOOL]

    const lowerMessage = messageText.toLowerCase()
    const relevantSkills = availableSkills.filter((skill) => lowerMessage.includes(skill.name.toLowerCase()))
    const skillHint =
        relevantSkills.length > 0
            ? `\n\nKnown related project skill files:\n${relevantSkills.map((skill) => `- ${skill.path}`).join('\n')}\nIf relevant, read these files before answering.`
            : ''

    const response = query({
        prompt: `${messageText}${skillHint}`,
        options: {
            systemPrompt: buildSystemPrompt(availableSkills),
            tools: options.includeBuiltinTools ? BUILTIN_TOOLS : [],
            allowedTools,
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
            settingSources: ['user', 'project'],
            ...(options.resumeSessionId ? { resume: options.resumeSessionId } : {})
        }
    })

    try {
        const commands = await response.supportedCommands()
        const commandNames = commands.map((cmd) => cmd.name)
        const knownSkills = availableSkills.filter((skill) => commandNames.includes(skill.name))
        console.log(
            `[agent] supported slash commands: ${commandNames.length} total${knownSkills.length > 0 ? ` | matched skills: ${knownSkills.map((skill) => skill.name).join(', ')}` : ''}`
        )
    } catch (error) {
        console.warn('[agent] could not read supportedCommands():', error)
    }

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
    const availableSkills = await discoverProjectSkills()

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
                const execution = await executeQueryAttempt(messageText, onChunk, attempt, mcpServer, availableSkills)
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
