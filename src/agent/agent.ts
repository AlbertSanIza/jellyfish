import { query, type Query } from '@anthropic-ai/claude-agent-sdk'
import type { Context } from 'grammy'
import telegramifyMarkdown from 'telegramify-markdown'

    const spinner = ora({ isEnabled: isatty(1) }).start('Thinking')
    const messages = query({
        prompt,
        options: {
            model: 'sonnet',
            permissionMode: 'acceptEdits'
        }
    })
    let response = ''
    for await (const message of messages) {
        if (message.type === 'assistant' && message.message?.content) {
            for (const block of message.message.content) {
                if ('text' in block) {
                    process.stdout.write(`${block.text}\n`)
                } else if ('name' in block) {
                    process.stdout.write(`Tool: ${block.name}\n`)
                }
            }
        } else if (message.type === 'result' && 'result' in message) {
            response = message.subtype
        }
    }
    spinner.stop()
    return telegramifyMarkdown(response, 'escape')
}
