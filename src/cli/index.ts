import { program } from 'commander'

import pkg from '../../package.json'
import { daemonCommand } from './daemon'
import { updateCommand } from './update'

program.name(pkg.name).description(pkg.description).version(pkg.version, '-v, --version')

program.addCommand(daemonCommand)
program.addCommand(updateCommand)

program.parse()
