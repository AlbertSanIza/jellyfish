import os from 'node:os'
import path from 'node:path'
import z from 'zod'

export const JELLYFISH_DIR = path.join(os.homedir(), '.jellyfish')
export const SETTINGS_PATH = path.join(JELLYFISH_DIR, 'settings.json')

export const settingsSchema = z.object({
    telegram: z.object({
        token: z.string().default(''),
        allowedChatIds: z.array(z.number()).default([])
    }),
    claude: z.object({
        model: z.enum(['haiku', 'sonnet', 'opus']).default('sonnet')
    })
})

