import chalk from 'chalk'
import { Command } from 'commander'
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { isatty } from 'node:tty'
import ora, { type Ora } from 'ora'

const LABEL = 'com.jellyfish.daemon'
const PLIST_DIR = join(homedir(), 'Library', 'LaunchAgents')
const PLIST_PATH = join(PLIST_DIR, `${LABEL}.plist`)
const LOG_DIR = join(homedir(), '.jellyfish', 'logs')
const GUI_DOMAIN = `gui/${process.getuid!()}`

let spinner: Ora

export const daemonCommand = new Command('daemon').description('Manage the Jellyfish daemon')

daemonCommand.hook('preAction', async (_thisCommand, actionCommand) => {
    if (actionCommand.name() !== 'run') spinner = ora({ isEnabled: isatty(1) })
})

daemonCommand
    .command('install')
    .description('Install Jellyfish as a LaunchAgent (auto-start on login)')
    .option('--force', 'Force reinstall even if already installed')
    .action(async (opts: { force?: boolean }) => {
        if (existsSync(PLIST_PATH) && !opts.force) {
            spinner.info(`Jellyfish is already installed. Use ${chalk.blue('--force')} to reinstall`)
            return
        }
        spinner.start('Installing Jellyfish')
        mkdirSync(PLIST_DIR, { recursive: true })
        mkdirSync(LOG_DIR, { recursive: true })
        await launchctl('bootout', GUI_DOMAIN, PLIST_PATH)
        const programArgs = getProgramArgs()
        writeFileSync(PLIST_PATH, buildPlist(programArgs))
        await launchctl('enable', `${GUI_DOMAIN}/${LABEL}`)
        const result = await launchctl('bootstrap', GUI_DOMAIN, PLIST_PATH)
        if (result.code !== 0) {
            spinner.fail(`Failed to install Jellyfish LaunchAgent: ${result.stderr}`)
            process.exit(1)
        }
        await launchctl('kickstart', '-k', `${GUI_DOMAIN}/${LABEL}`)
        spinner.succeed('Jellyfish Installed and Running!')
        console.log(chalk.dim(`  Plist:  ${PLIST_PATH}`))
        console.log(chalk.dim(`  Logs:   ${LOG_DIR}/out.log`))
    })

daemonCommand
    .command('uninstall')
    .description('Uninstall Jellyfish LaunchAgent')
    .action(async () => {
        if (!existsSync(PLIST_PATH)) {
            spinner.info(`Jellyfish is not installed, to get started run:\n${chalk.blue('jellyfish daemon install')}`)
            return
        }
        spinner.start('Uninstalling Jellyfish LaunchAgent...')
        await launchctl('bootout', GUI_DOMAIN, PLIST_PATH)
        unlinkSync(PLIST_PATH)
        spinner.succeed('Jellyfish uninstalled')
    })

daemonCommand
    .command('start')
    .description('Start Jellyfish')
    .action(async () => {
        if (!existsSync(PLIST_PATH)) {
            spinner.info(`Jellyfish is not installed, to get started run:\n${chalk.blue('jellyfish daemon install')}`)
            return
        }
        spinner.start('Starting Jellyfish...')
        await launchctl('bootstrap', GUI_DOMAIN, PLIST_PATH)
        await launchctl('enable', `${GUI_DOMAIN}/${LABEL}`)
        await launchctl('kickstart', '-k', `${GUI_DOMAIN}/${LABEL}`)
        spinner.succeed('Jellyfish started!')
    })

daemonCommand
    .command('stop')
    .description('Stop Jellyfish')
    .action(async () => {
        spinner.start('Stopping Jellyfish...')
        await launchctl('bootout', `${GUI_DOMAIN}/${LABEL}`)
        spinner.succeed('Jellyfish stopped!')
    })

daemonCommand
    .command('restart')
    .description('Restart Jellyfish')
    .action(async () => {
        spinner.start('Restarting Jellyfish...')
        const result = await launchctl('kickstart', '-k', `${GUI_DOMAIN}/${LABEL}`)
        if (result.code !== 0) {
            spinner.fail(`Failed to restart: ${result.stderr}`)
            process.exit(1)
        }
        spinner.succeed('Jellyfish restarted!')
    })

daemonCommand
    .command('status')
    .description('Show Jellyfish status')
    .action(async () => {
        if (!existsSync(PLIST_PATH)) {
            spinner.info(`Jellyfish is not installed, to get started run:\n${chalk.blue('jellyfish daemon install')}`)
            return
        }
        const result = await launchctl('print', `${GUI_DOMAIN}/${LABEL}`)
        if (result.code !== 0) {
            spinner.info('Jellyfish is not running')
            return
        }
        const output = result.stdout
        const state = extractValue(output, 'state')
        const pid = extractValue(output, 'pid')
        const lastExit = extractValue(output, 'last exit status')
        console.log(`Label:       ${LABEL}`)
        console.log(`State:       ${state || 'unknown'}`)
        console.log(`PID:         ${pid || 'N/A'}`)
        console.log(`Last Exit:   ${lastExit || 'N/A'}`)
        console.log(`Plist:       ${PLIST_PATH}`)
        console.log(`Logs:        ${LOG_DIR}/out.log`)
    })

daemonCommand
    .command('logs')
    .description('Show Jellyfish logs')
    .action(() => {
        const outLog = join(LOG_DIR, 'out.log')
        const errLog = join(LOG_DIR, 'err.log')
        const files = [outLog, errLog].filter(existsSync)
        if (!files.length) {
            spinner.info('No log files found')
            return
        }
        spawn('tail', ['-f', ...files], { stdio: 'inherit' })
    })

daemonCommand.command('run', { hidden: true }).action(async () => {
    loadEnvFile()
    await import('../agent/index')
})

function launchctl(...args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve) => {
        execFile('launchctl', args, { encoding: 'utf-8' }, (error, stdout, stderr) => {
            resolve({ stdout, stderr, code: error ? ((error as any).code ?? 1) : 0 })
        })
    })
}

function extractValue(output: string, key: string): string | undefined {
    const regex = new RegExp(`${key}\\s*=\\s*(.+)`, 'i')
    return output.match(regex)?.[1]?.trim()
}

function getProgramArgs(): string[] {
    // In dev: process.argv = ['bun', 'src/index.ts', 'daemon', 'install', ...]
    // In prod: process.argv = ['/path/to/jellyfish', 'daemon', 'install', ...]
    const daemonIdx = process.argv.indexOf('daemon')
    const base = process.argv.slice(0, daemonIdx)
    return [...base, 'daemon', 'run']
}

function buildPlist(programArgs: string[]): string {
    const argsXml = programArgs.map((arg) => `                <string>${arg}</string>`).join('\n')
    return `
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
            <key>Label</key>
            <string>${LABEL}</string>
            <key>ProgramArguments</key>
            <array>
                ${argsXml}
            </array>
            <key>RunAtLoad</key>
            <true/>
            <key>KeepAlive</key>
            <true/>
            <key>EnvironmentVariables</key>
            <dict>
                <key>PATH</key>
                <string>${process.env.PATH}</string>
                <key>HOME</key>
                <string>${homedir()}</string>
            </dict>
            <key>StandardOutPath</key>
            <string>${LOG_DIR}/out.log</string>
            <key>StandardErrorPath</key>
            <string>${LOG_DIR}/err.log</string>
        </dict>
        </plist>
    `
}

const ENV_PATH = join(homedir(), '.jellyfish', '.env')

function loadEnvFile() {
    if (!existsSync(ENV_PATH)) return
    const content = readFileSync(ENV_PATH, 'utf-8')
    for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eqIdx = trimmed.indexOf('=')
        if (eqIdx === -1) continue
        const key = trimmed.slice(0, eqIdx).trim()
        let value = trimmed.slice(eqIdx + 1).trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1)
        }
        if (!process.env[key]) process.env[key] = value
    }
}
