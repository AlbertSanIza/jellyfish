import { program } from 'commander'

import pkg from '../package.json'
import { helloWorldCommand } from './cli/hello-world'

program.name(pkg.name).description(pkg.description).version(pkg.version, '-v, --version')

program.addCommand(helloWorldCommand)

program.parse()
