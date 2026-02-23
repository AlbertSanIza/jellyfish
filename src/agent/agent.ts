import { query, type Query } from '@anthropic-ai/claude-agent-sdk'
import type { Context } from 'grammy'
import telegramifyMarkdown from 'telegramify-markdown'

export async function run(ctx: Context) {
    if (!ctx.message?.text) {
        return 'No message text found.'
    }
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
                    console.log(block.text)
                } else if ('name' in block) {
                    console.log(`Tool: ${block.name}`)
                    ctx.reply(`Tool: ${block.name}`)
                }
            }
        } else if (message.type === 'result' && 'result' in message) {
            response = message.subtype
        }
    }
    return telegramifyMarkdown(response, 'escape')
}
