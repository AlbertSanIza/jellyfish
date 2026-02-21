import { program } from 'commander'

import pkg from '../package.json'
import { daemonCommand } from './cli/daemon'
import { helloWorldCommand } from './cli/hello-world'
import { updateCommand } from './cli/update'

program.name(pkg.name).description(pkg.description).version(pkg.version, '-v, --version')

program.addCommand(daemonCommand)
program.addCommand(helloWorldCommand)
program.addCommand(updateCommand)

program.parse()
