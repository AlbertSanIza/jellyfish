import { program } from 'commander'

import pkg from '../../package.json'
import { claudeCommand } from './claude'
import { daemonCommand } from './daemon'
import { telegramCommand } from './telegram'
import { updateCommand } from './update'

program.name(pkg.name).description(pkg.description).version(pkg.version, '-v, --version')

program.addCommand(claudeCommand)
program.addCommand(daemonCommand)
program.addCommand(telegramCommand)
program.addCommand(updateCommand)

program.parse()
