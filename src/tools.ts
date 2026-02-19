import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const baseDir = path.join(os.homedir(), '.jellyfish')
const memoryDir = path.join(baseDir, 'memory')

const sanitizeName = (name: string): string =>
    name
        .trim()
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .replace(/^_+|_+$/g, '') || 'default'

const getMemoryPath = (name: string): string => path.join(memoryDir, `${sanitizeName(name)}.md`)

const ensureMemoryDir = async (): Promise<void> => {
    await fs.mkdir(memoryDir, { recursive: true })
}

const memoryRead = async (input: { name: string }): Promise<string> => {
    await ensureMemoryDir()
    const memoryPath = getMemoryPath(input.name)

    try {
        return await fs.readFile(memoryPath, 'utf8')
    } catch (error) {
        const err = error as NodeJS.ErrnoException
        if (err.code === 'ENOENT') {
            return 'not found'
        }
        throw error
    }
}

const memoryWrite = async (input: { name: string; content: string }): Promise<string> => {
    await ensureMemoryDir()
    const memoryPath = getMemoryPath(input.name)
    await fs.writeFile(memoryPath, input.content, 'utf8')
    return 'saved'
}

export const customMemoryTools = [
    {
        name: 'memory_read',
        description: 'Read a saved markdown memory by name.',
        input_schema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Memory note name without extension.'
                }
            },
            required: ['name'],
            additionalProperties: false
        },
        run: memoryRead
    },
    {
        name: 'memory_write',
        description: 'Write a markdown memory by name.',
        input_schema: {
            type: 'object',
            properties: {
                name: {
                    type: 'string',
                    description: 'Memory note name without extension.'
                },
                content: {
                    type: 'string',
                    description: 'Markdown content to save.'
                }
            },
            required: ['name', 'content'],
            additionalProperties: false
        },
        run: memoryWrite
    }
] as const
