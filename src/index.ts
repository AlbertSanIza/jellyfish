import { createBot } from './bot'
import { runAgent } from './agent'
import { startCronScheduler } from './cron'

const bot = createBot()

await startCronScheduler(async (job) => {
    try {
        const result = await runAgent(job.chatId, job.prompt)
        await bot.api.sendMessage(Number(job.chatId), result)
    } catch (err) {
        console.error('Cron job failed:', job.id, err)
    }
})

bot.start()

console.log('Jellyfish AI bot started.')

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    console.log(`Received ${signal}. Stopping bot...`)
    bot.stop()
}

process.once('SIGINT', () => {
    void shutdown('SIGINT')
})
process.once('SIGTERM', () => {
    void shutdown('SIGTERM')
})
