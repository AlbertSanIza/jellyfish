import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'

const memoryDir = path.join(os.homedir(), '.jellyfish', 'memory')
const pendingFilesByChat = new Map<number, PendingTelegramFile[]>()

export interface PendingTelegramFile {
    filePath: string
    caption?: string
}

const memoryReadTool = tool(
    'memory_read',
    'Reads a named memory file from ~/.jellyfish/memory/<name>.md',
    { name: z.string().describe('Memory file name (without .md extension)') },
    async ({ name }) => {
        await mkdir(memoryDir, { recursive: true })
        try {
            const content = await Bun.file(path.join(memoryDir, `${name}.md`)).text()
            return { content: [{ type: 'text' as const, text: content }] }
        } catch {
            return { content: [{ type: 'text' as const, text: 'not found' }] }
        }
    }
)

const memoryWriteTool = tool(
    'memory_write',
    'Writes content to a named memory file at ~/.jellyfish/memory/<name>.md',
    { name: z.string().describe('Memory file name (without .md extension)'), content: z.string().describe('Content to write') },
    async ({ name, content }) => {
        await mkdir(memoryDir, { recursive: true })
        await Bun.write(path.join(memoryDir, `${name}.md`), content)
        return { content: [{ type: 'text' as const, text: 'saved' }] }
    }
)

export const drainPendingFilesForChat = (chatId: number): PendingTelegramFile[] => {
    const pending = pendingFilesByChat.get(chatId) ?? []
    pendingFilesByChat.delete(chatId)
    return pending
}

export const createJellyfishMcpServer = (chatId: number): McpSdkServerConfigWithInstance => {
    const telegramSendFileTool = tool(
        'telegram_send_file',
        'Queue a local file so Jellyfish can send it to the Telegram user as a document. Use an absolute file path.',
        {
            file_path: z.string().describe('Absolute path to the file on local filesystem'),
            caption: z.string().optional().describe('Optional caption for the Telegram document')
        },
        async ({ file_path, caption }) => {
            if (!path.isAbsolute(file_path)) {
                return { content: [{ type: 'text' as const, text: 'File path must be absolute' }] }
            }

            const existing = pendingFilesByChat.get(chatId) ?? []
            existing.push({ filePath: file_path, caption })
            pendingFilesByChat.set(chatId, existing)

            return { content: [{ type: 'text' as const, text: `File queued for sending: ${file_path}` }] }
        }
    )

    return createSdkMcpServer({
        name: 'jellyfish-memory',
        tools: [memoryReadTool, memoryWriteTool, telegramSendFileTool]
    })
}
