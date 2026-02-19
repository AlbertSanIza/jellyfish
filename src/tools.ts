import { createSdkMcpServer, tool, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'

const memoryDir = path.join(os.homedir(), '.jellyfish', 'memory')

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

export const memoryMcpServer: McpSdkServerConfigWithInstance = createSdkMcpServer({
    name: 'jellyfish-memory',
    tools: [memoryReadTool, memoryWriteTool]
})
