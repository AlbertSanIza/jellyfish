import { Command, InvalidArgumentError } from 'commander'

import { readSettings, writeSettings } from '../settings'

export const telegramCommand = new Command('telegram').description('Manage telegram settings')

type Settings = Awaited<ReturnType<typeof readSettings>>
type UpdateResult = { changed?: boolean; message?: string } | void

function parseChatId(value: string) {
    const chatId = Number(value)
    if (Number.isNaN(chatId)) {
        throw new InvalidArgumentError('Chat ID must be a number.')
    }
    return chatId
}

async function updateSettings(update: (settings: Settings) => UpdateResult) {
    const settings = await readSettings()
    const result = update(settings) ?? {}
    if (result.changed !== false) {
        await writeSettings(settings)
    }
    if (result.message) {
        console.log(result.message)
    }
}

const tokenCommand = new Command('token').description('Manage Telegram bot token')

tokenCommand
    .command('set <value>')
    .description('Set the Telegram bot token')
    .action(async (value: string) => {
        await updateSettings((settings) => {
            settings.telegram.token = value
            return { message: 'Telegram token updated.' }
        })
    })

tokenCommand
    .command('clear')
    .description('Clear the Telegram bot token')
    .action(async () => {
        await updateSettings((settings) => {
            settings.telegram.token = ''
            return { message: 'Telegram token cleared.' }
        })
    })

telegramCommand.addCommand(tokenCommand)

const chatsCommand = new Command('chats').description('Manage allowed Telegram chat IDs')

chatsCommand
    .command('add <id>')
    .description('Add an allowed chat ID')
    .argument('<id>', 'chat id', parseChatId)
    .action(async (chatId: number) => {
        await updateSettings((settings) => {
            if (settings.telegram.allowedChatIds.includes(chatId)) {
                return { changed: false, message: `Chat ID ${chatId} is already in the list.` }
            }
            settings.telegram.allowedChatIds.push(chatId)
            return { message: `Added chat ID ${chatId}.` }
        })
    })

chatsCommand
    .command('remove <id>')
    .description('Remove an allowed chat ID')
    .argument('<id>', 'chat id', parseChatId)
    .action(async (chatId: number) => {
        await updateSettings((settings) => {
            const nextIds = settings.telegram.allowedChatIds.filter((id) => id !== chatId)
            if (nextIds.length === settings.telegram.allowedChatIds.length) {
                throw new InvalidArgumentError(`Chat ID ${chatId} is not in the list.`)
            }
            settings.telegram.allowedChatIds = nextIds
            return { message: `Removed chat ID ${chatId}.` }
        })
    })

chatsCommand
    .command('list')
    .description('List allowed chat IDs')
    .action(async () => {
        const { allowedChatIds } = (await readSettings()).telegram
        console.log(allowedChatIds.length ? allowedChatIds.join('\n') : 'No allowed chat IDs configured.')
    })

telegramCommand.addCommand(chatsCommand)
