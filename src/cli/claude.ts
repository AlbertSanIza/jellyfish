import select from '@inquirer/select'
import { Command } from 'commander'
import type { z } from 'zod'

import { settingsSchema } from '../settings'
import { SETTINGS_PATH } from '../utils'

const CLAUDE_MODELS = ['sonnet', 'opus'] as const

export const claudeCommand = new Command('claude').description('Manage claude settings')

const modelCommand = new Command('model').description('Manage Claude model')

modelCommand
    .command('set <value>')
    .description('Set the Claude model (sonnet, opus)')
    .action(async (value: string) => {
        if (!CLAUDE_MODELS.includes(value as (typeof CLAUDE_MODELS)[number])) {
            console.error(`Invalid model "${value}". Must be one of: ${CLAUDE_MODELS.join(', ')}`)
            process.exit(1)
        }
        const settings = await readSettings()
        settings.claude.model = value as (typeof CLAUDE_MODELS)[number]
        await writeSettings(settings)
        console.log(`Claude model set to ${value}.`)
    })

modelCommand.action(async () => {
    const settings = await readSettings()
    const current = settings.claude.model

    const model = await select({
        message: 'Select Claude model',
        choices: CLAUDE_MODELS.map((m) => ({
            name: m === current ? `${m} (current)` : m,
            value: m
        }))
    })

    settings.claude.model = model
    await writeSettings(settings)
    console.log(`Claude model set to ${model}.`)
})

claudeCommand.addCommand(modelCommand)

async function readSettings() {
    const settingsFile = Bun.file(SETTINGS_PATH)
    return settingsSchema.parse((await settingsFile.exists()) ? await settingsFile.json() : { telegram: {}, claude: {} })
}

async function writeSettings(data: z.infer<typeof settingsSchema>) {
    await Bun.write(SETTINGS_PATH, JSON.stringify(settingsSchema.parse(data), null, 2))
}
