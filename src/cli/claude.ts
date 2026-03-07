import select from '@inquirer/select'
import { Command } from 'commander'
import type { z } from 'zod'

import { settingsSchema } from '../settings'
import { SETTINGS_PATH } from '../utils'

const CLAUDE_MODELS = ['sonnet', 'opus'] as const

export const claudeCommand = new Command('claude').description('Manage claude settings')

const modelCommand = new Command('model').description('Manage Claude model')

modelCommand.action(async () => {
    const settings = await readSettings()
    settings.claude.model = await select({
        message: 'Select Model',
        choices: CLAUDE_MODELS.map((model) => ({ value: model, name: model === settings.claude.model ? `${model} (current)` : model }))
    })
    await writeSettings(settings)
})

claudeCommand.addCommand(modelCommand)

async function readSettings() {
    const settingsFile = Bun.file(SETTINGS_PATH)
    return settingsSchema.parse((await settingsFile.exists()) ? await settingsFile.json() : { telegram: {}, claude: {} })
}

async function writeSettings(data: z.infer<typeof settingsSchema>) {
    await Bun.write(SETTINGS_PATH, JSON.stringify(settingsSchema.parse(data), null, 2))
}
