import { program } from 'commander'

import pkg from '../package.json'
import { deamonCommand } from './cli/deamon'
import { helloWorldCommand } from './cli/hello-world'
import { updateCommand } from './cli/update'

program.name(pkg.name).description(pkg.description).version(pkg.version, '-v, --version')

program.addCommand(deamonCommand)
program.addCommand(helloWorldCommand)
program.addCommand(updateCommand)

program.parse()
