import { z } from 'zod'

import path from 'node:path'
import { JELLYFISH_DIR } from './utils'

export const CLAUDE_MODELS = ['sonnet', 'opus'] as const
export const SETTINGS_PATH = path.join(JELLYFISH_DIR, 'settings.json')

export const settingsSchema = z.object({
    telegram: z.object({
        token: z.string().default(''),
        allowedChatIds: z.array(z.number()).default([])
    }),
    claude: z.object({
        model: z.enum(CLAUDE_MODELS).default('sonnet')
    })
})

export async function readSettings() {
    const file = Bun.file(SETTINGS_PATH)
    if (!(await file.exists())) {
        return settingsSchema.parse({ telegram: {}, claude: {} })
    }
    return settingsSchema.parse(await file.json())
}

export async function writeSettings(settings: z.infer<typeof settingsSchema>) {
    await Bun.write(SETTINGS_PATH, JSON.stringify(settings, null, 2))
}
