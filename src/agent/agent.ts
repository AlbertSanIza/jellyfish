import { query, type CanUseTool } from '@anthropic-ai/claude-agent-sdk'
import chalk from 'chalk'
import { isatty } from 'node:tty'
import ora from 'ora'
import telegramifyMarkdown from 'telegramify-markdown'

export async function run(prompt: string, canUseTool?: CanUseTool): Promise<string> {
    const spinner = ora({ isEnabled: isatty(1) }).start('Thinking')
    process.stdout.write(`${chalk.bold.white('User:')}\n${chalk.green(prompt)}\n`)
    const response = query({
        prompt,
        options: {
            canUseTool,
            model: 'sonnet',
            permissionMode: 'acceptEdits'
        }
    })
    let text = ''
    for await (const message of response) {
        if (message.type === 'assistant' && message.message?.content) {
            for (const block of message.message.content) {
                if ('text' in block) {
                    process.stdout.write(`${chalk.bold.white('Partial:')}\n${chalk.italic.dim(block.text)}\n`)
                } else if ('name' in block) {
                    process.stdout.write(`${chalk.bold.white(`${block.name}(`)}${chalk.dim(block.input.command)}${chalk.bold.white(`)`)}\n`)
                }
            }
        } else if (message.type === 'result') {
            text = message.result
            process.stdout.write(`${chalk.bold.white('Agent:')}\n${chalk.blue(text)}\n`)
        }
    }
    spinner.stop()
    return telegramifyMarkdown(text, 'escape')
}
