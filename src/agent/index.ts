import chalk from 'chalk'
import figlet from 'figlet'

import { createBot } from './telegram'

const bot = createBot()

bot.start()

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    console.log(`Received ${signal}. Stopping Jellyfish...`)
    bot.stop()
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))

console.log(chalk.blue(figlet.textSync('JELLYFISH', { font: 'Small' })))
