import { run } from '@grammyjs/runner'
import chalk from 'chalk'
import figlet from 'figlet'

import { createBot } from './telegram'

const bot = createBot()
await bot.api.deleteWebhook({ drop_pending_updates: true })

const runner = run(bot, {
    runner: {
        fetch: {
            allowed_updates: ['message', 'callback_query']
        }
    }
})

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    console.log(`Received ${signal}. Stopping Jellyfish...`)
    runner.stop()
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))

console.log(chalk.blue(figlet.textSync('JELLYFISH', { font: 'Small' })))
