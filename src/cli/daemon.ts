import chalk from 'chalk'
import { Command } from 'commander'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
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
    if (actionCommand.name() !== 'run') {
        spinner = ora({ isEnabled: isatty(1) })
        await connect()
    }
})

daemonCommand.hook('postAction', (_thisCommand, actionCommand) => {
    if (actionCommand.name() !== 'run') {
        disconnect()
    }
})

daemonCommand
    .command('start')
    .description('Start Jellyfish')
    .action(async () => {
        spinner.start('Starting Jellyfish...')
        await pm2Start({ name: 'jellyfish', script: process.argv[0], args: ['daemon', 'run'] })
        spinner.succeed('Jellyfish Started!')
    })

daemonCommand
    .command('stop')
    .description('Stop Jellyfish')
    .action(async () => {
        spinner.start('Stopping Jellyfish...')
        await pm2Action('stop')
        spinner.succeed('Jellyfish Stopped!')
    })

daemonCommand
    .command('restart')
    .description('Restart Jellyfish')
    .action(async () => {
        spinner.start('Restarting Jellyfish...')
        await pm2Action('restart')
        spinner.succeed('Jellyfish Restarted!')
    })

daemonCommand
    .command('status')
    .description('Show Jellyfish status')
    .action(async () => {
        const list = await pm2Describe()
        if (!list.length) {
            spinner.info(`Jellyfish is not registered, to get started run:\n${chalk.blue('jellyfish daemon start')}`)
            return
        }
        const proc = list[0]!
        console.log(`Name:      ${proc.name}`)
        console.log(`Status:    ${proc.pm2_env?.status}`)
        console.log(`PID:       ${proc.pid}`)
        console.log(`Uptime:    ${proc.pm2_env?.pm_uptime ? new Date(proc.pm2_env.pm_uptime).toISOString() : 'N/A'}`)
        console.log(`Restarts:  ${proc.pm2_env?.restart_time}`)
        console.log(`CPU:       ${proc.monit?.cpu}%`)
        console.log(`Memory:    ${proc.monit?.memory ? (proc.monit.memory / 1024 / 1024).toFixed(1) + ' MB' : 'N/A'}`)
    })

daemonCommand
    .command('logs')
    .description('Show Jellyfish logs')
    .action(async () => {
        const list = await pm2Describe()
        if (!list.length) {
            spinner.info(`Jellyfish is not registered, to get started run:\n${chalk.blue('jellyfish daemon start')}`)
            return
        }
        const logFile = list[0]!.pm2_env?.pm_out_log_path
        const errFile = list[0]!.pm2_env?.pm_err_log_path
        if (logFile) {
            console.log(`Out: ${logFile}`)
        }
        if (errFile) {
            console.log(`Err: ${errFile}`)
        }
        spawnSync('tail', ['-f', logFile, errFile].filter(Boolean) as string[], { stdio: 'inherit' })
    })

daemonCommand
    .command('save')
    .description('Save current process list for auto-restart on reboot')
    .action(async () => {
        await pm2Dump()
        console.log('Jellyfish process list saved')
    })

daemonCommand.command('run', { hidden: true }).action(async () => {
    await import('../agent/index')
})

function connect(): Promise<void> {
    return new Promise((resolve, reject) => {
        pm2.connect((err) => (err ? reject(err) : resolve()))
    })
}

function disconnect(): void {
    pm2.disconnect()
}

function pm2Start(opts: pm2.StartOptions): Promise<void> {
    return new Promise((resolve, reject) => {
        pm2.start(opts, (err) => (err ? reject(err) : resolve()))
    })
}

function pm2Action(action: 'stop' | 'restart'): Promise<void> {
    return new Promise((resolve, reject) => {
        pm2[action]('jellyfish', (err) => (err ? reject(err) : resolve()))
    })
}

function pm2Describe(): Promise<pm2.ProcessDescription[]> {
    return new Promise((resolve, reject) => {
        pm2.describe('jellyfish', (err, list) => (err ? reject(err) : resolve(list)))
    })
}

function pm2Dump(): Promise<void> {
    return new Promise((resolve, reject) => {
        pm2.dump((err) => (err ? reject(err) : resolve()))
    })
}
