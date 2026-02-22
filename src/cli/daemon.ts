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
        await connect()
    }
})

daemonCommand.hook('postAction', async (_thisCommand, actionCommand) => {
    const name = actionCommand.name()
    if (name !== 'run') {
        if (name !== 'status' && name !== 'logs') {
            await pm2Dump()
        }
        disconnect()
    }
})

daemonCommand
    .command('start')
    .description('Start Jellyfish')
    .action(async () => {
        spinner.start('Starting Jellyfish...')
        const list = await pm2Describe()
        if (list.length) {
            await pm2Action('restart')
        } else {
            await pm2Start({ name: PROCESS_NAME, script: process.argv[0], args: ['daemon', 'run'] })
        }
        spinner.succeed('Jellyfish Started!')
    })

daemonCommand
    .command('stop')
    .description('Stop Jellyfish')
    .action(async () => {
        spinner.start('Stopping Jellyfish...')
        const list = await pm2Describe()
        if (!list.length || list[0]!.pm2_env?.status === 'stopped') {
            spinner.info('Jellyfish is NOT Running')
            return
        }
        await pm2Action('stop')
        spinner.succeed('Jellyfish Stopped!')
    })

daemonCommand
    .command('restart')
    .description('Restart Jellyfish')
    .action(async () => {
        spinner.start('Restarting Jellyfish...')
        const list = await pm2Describe()
        if (!list.length) {
            spinner.info(`Jellyfish is not registered, to get started run:\n${chalk.blue('jellyfish daemon start')}`)
            return
        }
        await pm2Action('restart')
        spinner.succeed('Jellyfish Restarted!')
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
        console.log(`Uptime:   ${proc.pm2_env?.pm_uptime ? new Date(proc.pm2_env.pm_uptime).toISOString() : 'N/A'}`)
        console.log(`Restarts: ${proc.pm2_env?.restart_time}`)
        console.log(`CPU:      ${proc.monit?.cpu}%`)
        console.log(`Memory:   ${proc.monit?.memory ? (proc.monit.memory / 1024 / 1024).toFixed(1) + ' MB' : 'N/A'}`)
    })

daemonCommand
    .command('logs')
    .description('Jellyfish Logs')
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

daemonCommand.command('run', { hidden: true }).action(async () => {
    await import('../agent/index')
})

function connect(): Promise<void> {
    return new Promise((resolve, reject) => {
        pm2.connect((err) => (err ? reject(err) : resolve()))
    })
}

function pm2Start(opts: pm2.StartOptions): Promise<void> {
    return new Promise((resolve, reject) => {
        pm2.start(opts, (err) => (err ? reject(err) : resolve()))
    })
}

function pm2Action(action: 'stop' | 'restart'): Promise<void> {
    return new Promise((resolve, reject) => {
        pm2[action](PROCESS_NAME, (err) => (err ? reject(err) : resolve()))
    })
}

function pm2Describe(): Promise<pm2.ProcessDescription[]> {
    return new Promise((resolve, reject) => {
        pm2.describe(PROCESS_NAME, (err, list) => (err ? reject(err) : resolve(list)))
    })
}

function pm2Dump(): Promise<void> {
    return new Promise((resolve, reject) => {
        pm2.dump((err) => (err ? reject(err) : resolve()))
    })
}

function disconnect(): void {
    pm2.disconnect()
}
