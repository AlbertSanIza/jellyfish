/**
 * Converts standard markdown to Telegram HTML.
 * Telegram supports: <b>, <i>, <u>, <s>, <code>, <pre>, <a href="">
 *
 * Uses placeholder substitution to protect code spans from italic/bold processing.
 */
export const markdownToHtml = (text: string): string => {
    const protected_: string[] = []

    const protect = (html: string): string => {
        const idx = protected_.length
        protected_.push(html)
        return `\x00P${idx}\x00`
    }

    // Escape HTML special chars
    let out = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    // Protect fenced code blocks first (``` ... ```) — multi-line safe
    out = out.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_, code: string) => protect(`<pre><code>${code.trimEnd()}</code></pre>`))

    // Protect inline code (` ... `)
    out = out.replace(/`([^`\n]+)`/g, (_, code: string) => protect(`<code>${code}</code>`))

    // Bold — **text** or __text__
    out = out.replace(/\*\*(.+?)\*\*/gs, '<b>$1</b>')
    out = out.replace(/__(.+?)__/gs, '<b>$1</b>')

    // Italic — *text* (single asterisk, not part of **)
    out = out.replace(/(?<!\*)\*(?!\*)([^*\n]+?)(?<!\*)\*(?!\*)/g, '<i>$1</i>')

    // Italic — _text_ only at word boundaries (prevents matching snake_case)
    out = out.replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, '<i>$1</i>')

    // Strikethrough — ~~text~~
    out = out.replace(/~~(.+?)~~/gs, '<s>$1</s>')

    // Links — [text](url)
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>')

    // Restore protected code spans
    out = out.replace(/\x00P(\d+)\x00/g, (_, idx: string) => protected_[parseInt(idx, 10)] ?? '')

    return out
}
