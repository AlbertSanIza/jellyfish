import os from 'node:os'
import path from 'node:path'

interface Settings {
    telegram: {
        token: string
        allowedChatIds: number[]
    }
    claude: {
        model: string
    }
}

const TEMPLATE: Settings = {
    telegram: {
        token: '',
        allowedChatIds: []
    },
    claude: {
        model: 'sonnet'
    }
}

const JELLYFISH_DIR = path.join(os.homedir(), '.jellyfish')
const SETTINGS_PATH = path.join(JELLYFISH_DIR, 'settings.json')

export async function loadSettings(): Promise<Settings> {
    const file = Bun.file(SETTINGS_PATH)

    if (!(await file.exists())) {
        await Bun.write(SETTINGS_PATH, JSON.stringify(TEMPLATE, null, 2))
        console.error(`Created template settings at ${SETTINGS_PATH} — fill it in and restart.`)
        process.exit(1)
    }

    const raw = JSON.parse(await file.text()) as Record<string, unknown>
    const tg = (typeof raw.telegram === 'object' && raw.telegram !== null ? raw.telegram : {}) as Record<string, unknown>
    const claude = (typeof raw.claude === 'object' && raw.claude !== null ? raw.claude : {}) as Record<string, unknown>

    const token = typeof tg.token === 'string' ? tg.token : ''
    if (!token || token === 'YOUR_BOT_TOKEN') {
        console.error(`Set a valid telegram.token in ${SETTINGS_PATH}`)
        process.exit(1)
    }
    return {
        telegram: {
            token,
            allowedChatIds: Array.isArray(tg.allowedChatIds) ? tg.allowedChatIds.filter((id): id is number => typeof id === 'number') : []
        },
        claude: {
            model: typeof claude.model === 'string' ? claude.model : 'sonnet'
        }
    }
}

export const settings = await loadSettings()
