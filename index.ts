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

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    console.log(`Received ${signal}. Stopping bot...`)
    bot.stop()
}

process.once('SIGINT', () => void shutdown('SIGINT'))
process.once('SIGTERM', () => void shutdown('SIGTERM'))
