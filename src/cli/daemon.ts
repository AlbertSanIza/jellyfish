import chalk from 'chalk'
import { Command } from 'commander'
import { spawnSync } from 'node:child_process'
import { isatty } from 'node:tty'
import ora, { type Ora } from 'ora'
import pm2 from 'pm2'

let spinner: Ora
const PROCESS_NAME = 'jellyfish'

export const daemonCommand = new Command('daemon').description('Manage the Jellyfish daemon')

daemonCommand.hook('preAction', async (_thisCommand, actionCommand) => {
    if (actionCommand.name() !== 'run') {
        spinner = ora({ isEnabled: isatty(1) })
        try {
            await connect()
        } catch (err) {
            spinner.fail(`Failed to connect to pm2: ${err instanceof Error ? err.message : err}`)
            process.exit(1)
        }
    }
})

daemonCommand.hook('postAction', async (_thisCommand, actionCommand) => {
    switch (actionCommand.name()) {
        case 'run':
        case 'logs':
            break
        case 'status':
        case 'delete':
            disconnect()
            break
        default:
            await pm2Action('dump')
            disconnect()
            break
    }
})

daemonCommand
    .command('start')
    .description('Start Jellyfish')
    .action(async () => {
        spinner.start('Starting Jellyfish')
        const list = await pm2Describe()
        if (list.length) {
            await pm2Action('restart')
        } else {
            await pm2Start({ name: PROCESS_NAME, script: process.argv[0], args: ['daemon', 'run'] })
        }
        spinner.succeed('Jellyfish Started')
    })

daemonCommand
    .command('restart')
    .description('Restart Jellyfish')
    .action(async () => {
        spinner.start('Restarting Jellyfish')
        const list = await pm2Describe()
        if (!list.length) {
            spinner.info(`Jellyfish is not registered, to get started run:\n${chalk.blue('jellyfish daemon start')}`)
            return
        }
        await pm2Action('restart')
        spinner.succeed('Jellyfish Restarted')
    })

daemonCommand
    .command('stop')
    .description('Stop Jellyfish')
    .action(async () => {
        spinner.start('Stopping Jellyfish')
        const list = await pm2Describe()
        if (!list.length || list[0]!.pm2_env?.status === 'stopped') {
            spinner.info('Jellyfish is NOT Running')
            return
        }
        await pm2Action('stop')
        spinner.succeed('Jellyfish Stopped')
    })

daemonCommand
    .command('status')
    .description('Jellyfish Status')
    .action(async () => {
        const list = await pm2Describe()
        if (!list.length) {
            spinner.info(`Jellyfish is not registered, to get started run:\n${chalk.blue('jellyfish daemon start')}`)
            return
        }
        const proc = list[0]!
        console.log(`Name:     ${proc.name}`)
        console.log(`Status:   ${proc.pm2_env?.status}`)
        console.log(`PID:      ${proc.pid}`)
        console.log(`Uptime:   ${proc.pm2_env?.pm_uptime ? formatUptime(Date.now() - proc.pm2_env.pm_uptime) : 'N/A'}`)
        console.log(`Restarts: ${proc.pm2_env?.restart_time}`)
        console.log(`CPU:      ${proc.monit?.cpu}%`)
        console.log(`Memory:   ${proc.monit?.memory ? (proc.monit.memory / 1024 / 1024).toFixed(1) + ' MB' : 'N/A'}`)
    })

daemonCommand
    .command('logs')
    .description('Jellyfish Logs')
    .action(async () => {
        disconnect()
        const result = spawnSync('pm2', ['logs', PROCESS_NAME], { stdio: 'inherit' })
        if (result.error) {
            spinner.fail(`pm2 CLI not found. Install it with:\n${chalk.blue('bun install -g pm2')}`)
        }
    })

daemonCommand
    .command('delete')
    .description('Remove Jellyfish from pm2 process list')
    .action(async () => {
        const list = await pm2Describe()
        if (!list.length) {
            spinner.info('Jellyfish is not registered')
            return
        }
        spinner.start('Removing Jellyfish...')
        await pm2Action('delete')
        spinner.succeed('Jellyfish removed from pm2')
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

function pm2Describe(): Promise<pm2.ProcessDescription[]> {
    return new Promise((resolve, reject) => {
        pm2.describe(PROCESS_NAME, (err, list) => (err ? reject(err) : resolve(list)))
    })
}

function pm2Action(action: 'restart' | 'stop' | 'delete' | 'dump'): Promise<void> {
    return new Promise((resolve, reject) => {
        if (action === 'dump') {
            pm2.dump((err) => (err ? reject(err) : resolve()))
        } else {
            pm2[action](PROCESS_NAME, (err) => (err ? reject(err) : resolve()))
        }
    })
}

function formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000)
    const days = Math.floor(seconds / 86400)
    const hours = Math.floor((seconds % 86400) / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    const parts: string[] = []
    if (days) parts.push(`${days}d`)
    if (hours) parts.push(`${hours}h`)
    if (minutes) parts.push(`${minutes}m`)
    return parts.length ? parts.join(' ') : '<1m'
}
