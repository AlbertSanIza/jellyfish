import os from 'node:os'
import path from 'node:path'

export const JELLYFISH_DIR = path.join(os.homedir(), '.jellyfish')
export const SETTINGS_PATH = path.join(JELLYFISH_DIR, 'settings.json')
