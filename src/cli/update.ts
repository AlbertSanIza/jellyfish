import { Command } from 'commander'

export const updateCommand = new Command('update').description('Upgrade to latest version of Jellyfish').alias('upgrade')

updateCommand.action(async () => {
    const result = Bun.spawnSync(['bash', '-c', 'curl -fsSL https://raw.githubusercontent.com/AlbertSanIza/jellyfish/main/install.sh | bash'], {
        stdout: 'inherit',
        stderr: 'inherit'
    })
    process.exit(result.exitCode)
})
