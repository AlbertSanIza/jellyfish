import chalk from 'chalk'
import figlet from 'figlet'

import { runAgent } from './src/agent'
import { startCronScheduler } from './src/cron'
import { createBot } from './src/telegram'

const bot = createBot()

startCronScheduler(async (job) => {
    try {
        const result = await runAgent(Number(job.chatId), job.prompt)
        await bot.api.sendMessage(Number(job.chatId), result)
    } catch (err) {
        console.error('Cron job failed:', job.id, err)
    }
}).catch(console.error)

bot.start()

const title = chalk.blue(figlet.textSync('JELLYFISH', { font: 'Small' }))
const titleLines = title.split('\n')
const titleWidth = Math.max(...titleLines.map((line) => line.replace(/\x1b\[[0-9;]*m/g, '').length))
const welcomeText = 'Welcome to'
const padding = Math.floor((titleWidth - welcomeText.length) / 2)
console.log(' '.repeat(padding) + chalk.white(welcomeText))
console.log(title)

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    console.log(`Received ${signal}. Stopping bot...`)
    bot.stop()
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
