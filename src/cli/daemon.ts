import { Command } from 'commander'
import pm2 from 'pm2'

const NAME = 'jellyfish'
const SCRIPT = new URL('../agent/bot.ts', import.meta.url).pathname

function connect(): Promise<void> {
    return new Promise((resolve, reject) => {
        pm2.connect((err) => (err ? reject(err) : resolve()))
    })
}

function disconnect(): void {
    pm2.disconnect()
}

export const daemonCommand = new Command('daemon').description('Manage the Jellyfish daemon')

daemonCommand
    .command('start')
    .description('Start the daemon')
    .action(async () => {
        await connect()
        pm2.start({ script: SCRIPT, name: NAME, interpreter: 'bun' }, (err) => {
            if (err) {
                disconnect()
                console.error('Failed to start gateway:', err)
                process.exit(1)
            }
            console.log('Gateway started')
            disconnect()
        })
    })

daemonCommand
    .command('stop')
    .description('Stop the daemon')
    .action(async () => {
        await connect()
        pm2.stop(NAME, (err) => {
            if (err) {
                disconnect()
                console.error('Failed to stop daemon:', err)
                process.exit(1)
            }
            console.log('daemon stopped')
            disconnect()
        })
    })

daemonCommand
    .command('restart')
    .description('Restart the daemon')
    .action(async () => {
        await connect()
        pm2.restart(NAME, (err) => {
            if (err) {
                disconnect()
                console.error('Failed to restart daemon:', err)
                process.exit(1)
            }
            console.log('daemon restarted')
            disconnect()
        })
    })

daemonCommand
    .command('status')
    .description('Show daemon status')
    .action(async () => {
        await connect()
        pm2.describe(NAME, (err, list) => {
            if (err || !list.length) {
                disconnect()
                console.log('daemon is not running')
                process.exit(err ? 1 : 0)
            }
            const proc = list[0]
            console.log(`Name:      ${proc.name}`)
            console.log(`Status:    ${proc.pm2_env?.status}`)
            console.log(`PID:       ${proc.pid}`)
            console.log(`Uptime:    ${proc.pm2_env?.pm_uptime ? new Date(proc.pm2_env.pm_uptime).toISOString() : 'N/A'}`)
            console.log(`Restarts:  ${proc.pm2_env?.restart_time}`)
            console.log(`CPU:       ${proc.monit?.cpu}%`)
            console.log(`Memory:    ${proc.monit?.memory ? (proc.monit.memory / 1024 / 1024).toFixed(1) + ' MB' : 'N/A'}`)
            disconnect()
        })
    })

daemonCommand
    .command('logs')
    .description('Show daemon logs')
    .action(async () => {
        await connect()
        pm2.describe(NAME, (err, list) => {
            disconnect()
            if (err || !list.length) {
                console.log('daemon is not running')
                process.exit(err ? 1 : 0)
            }
            const logFile = list[0].pm2_env?.pm_out_log_path
            const errFile = list[0].pm2_env?.pm_err_log_path
            if (logFile) console.log(`Out: ${logFile}`)
            if (errFile) console.log(`Err: ${errFile}`)
            const { spawnSync } = require('child_process')
            spawnSync('tail', ['-f', logFile, errFile].filter(Boolean) as string[], { stdio: 'inherit' })
        })
    })

daemonCommand
    .command('save')
    .description('Save current process list for auto-restart on reboot')
    .action(async () => {
        await connect()
        pm2.dump((err) => {
            if (err) {
                disconnect()
                console.error('Failed to save:', err)
                process.exit(1)
            }
            console.log('Process list saved')
            disconnect()
        })
    })
