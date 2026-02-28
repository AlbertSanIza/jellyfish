import os from 'node:os'
import path from 'node:path'

const JELLYFISH_DIR = path.join(os.homedir(), '.jellyfish')
const SETTINGS_PATH = path.join(JELLYFISH_DIR, 'settings.json')

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

export async function loadSettings(): Promise<Settings> {
    const file = await Bun.file(SETTINGS_PATH)
    if (!(await file.exists())) {
        await Bun.write(SETTINGS_PATH, JSON.stringify(TEMPLATE, null, 4))
        process.exit(1)
    }
    const settings: Settings = await file.json()
    if (!settings.telegram.token) {
        console.error(`Set a valid telegram.token in ${SETTINGS_PATH}`)
        process.exit(1)
    }

    return settings
}

export const settings = await loadSettings()
