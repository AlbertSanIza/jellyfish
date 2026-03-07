import select from '@inquirer/select'
import { Command } from 'commander'

import { CLAUDE_MODELS, readSettings, writeSettings } from '../settings'

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
