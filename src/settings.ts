import { z } from 'zod'

import { SETTINGS_PATH } from './utils'

const settingsSchema = z.object({
    telegram: z.object({
        token: z.string().min(10).default(''),
        allowedChatIds: z.array(z.number()).default([])
    }),
    claude: z.object({
        model: z.string().default('sonnet')
    })
})

async function loadSettings(): Promise<z.infer<typeof settingsSchema>> {
    const file = Bun.file(SETTINGS_PATH)
    if (!(await file.exists())) {
        await Bun.write(SETTINGS_PATH, JSON.stringify(settingsSchema.parse({ telegram: {}, claude: {} }), null, 2))
        console.error(`Created settings at ${SETTINGS_PATH} — fill it in and restart.`)
        process.exit(1)
    }
    const result = settingsSchema.safeParse(await file.json())
    if (!result.success) {
        console.log('Invalid Settings File:')
        console.error(`${result.error.issues.map((index) => `- ${index.path.join('.')}: ${index.message}`).join('\n')}`)
        process.exit(1)
    }

    return result.data
}

export const settings = await loadSettings()
