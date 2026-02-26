import { listSessions } from '@anthropic-ai/claude-agent-sdk'
import { mkdir, unlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

async function getSessions() {
    return await listSessions({ dir: process.cwd() })
}

export type SessionRole = 'system' | 'user' | 'assistant'

export interface SessionMessage {
    role: SessionRole
    content: string
    timestamp: string
}

export interface SessionData {
    sdkSessionId?: string // Claude Agent SDK session ID — used to resume the conversation
    messages: SessionMessage[]
}

const baseDir = path.join(os.homedir(), '.jellyfish')
const sessionsDir = path.join(baseDir, 'sessions')

const getSessionPath = (chatId: number): string => path.join(sessionsDir, `${chatId}.json`)

const ensureSessionsDir = async (): Promise<void> => {
    await mkdir(sessionsDir, { recursive: true })
}

const isSessionMessage = (item: unknown): item is SessionMessage => {
    if (typeof item !== 'object' || item === null) return false
    const c = item as Record<string, unknown>
    return (c.role === 'system' || c.role === 'user' || c.role === 'assistant') && typeof c.content === 'string' && typeof c.timestamp === 'string'
}

export const loadSession = async (chatId: number): Promise<SessionData> => {
    await ensureSessionsDir()
    const sessionPath = getSessionPath(chatId)
    try {
        const raw = await Bun.file(sessionPath).text()
        const parsed = JSON.parse(raw) as unknown
        // Legacy format: plain array of messages
        if (Array.isArray(parsed)) {
            return { messages: parsed.filter(isSessionMessage) }
        }
        // Current format: { sdkSessionId?, messages[] }
        if (typeof parsed === 'object' && parsed !== null) {
            const data = parsed as Record<string, unknown>
            return {
                sdkSessionId: typeof data.sdkSessionId === 'string' ? data.sdkSessionId : undefined,
                messages: Array.isArray(data.messages) ? data.messages.filter(isSessionMessage) : []
            }
        }
        return { messages: [] }
    } catch (error) {
        const err = error as NodeJS.ErrnoException
        if (err.code === 'ENOENT') return { messages: [] }
        throw error
    }
}

export const saveSession = async (chatId: number, data: SessionData): Promise<void> => {
    await ensureSessionsDir()
    const sessionPath = getSessionPath(chatId)
    await Bun.write(sessionPath, JSON.stringify(data, null, 2))
}

export interface SessionInfo {
    chatId: number
    sdkSessionId?: string
    messageCount: number
    lastMessage?: SessionMessage
    modifiedAt: Date
}

// export const listSessions = async (limit = 10): Promise<SessionInfo[]> => {
//     await ensureSessionsDir()
//     let files: string[]
//     try {
//         files = await readdir(sessionsDir)
//     } catch {
//         return []
//     }
//     const sessionFiles = files.filter((f) => f.endsWith('.json'))
//     const sessions: SessionInfo[] = []
//     for (const file of sessionFiles) {
//         const chatId = parseInt(file.replace('.json', ''), 10)
//         if (isNaN(chatId)) continue
//         const filePath = path.join(sessionsDir, file)
//         const [data, stats] = await Promise.all([loadSession(chatId), stat(filePath)])
//         sessions.push({
//             chatId,
//             sdkSessionId: data.sdkSessionId,
//             messageCount: data.messages.length,
//             lastMessage: data.messages[data.messages.length - 1],
//             modifiedAt: stats.mtime
//         })
//     }
//     return sessions.sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime()).slice(0, limit)
// }

export const clearSession = async (chatId: number): Promise<void> => {
    await ensureSessionsDir()
    const sessionPath = getSessionPath(chatId)
    try {
        await unlink(sessionPath)
    } catch (error) {
        const err = error as NodeJS.ErrnoException
        if (err.code !== 'ENOENT') throw error
    }
}
