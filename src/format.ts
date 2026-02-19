/**
 * Converts standard markdown to Telegram HTML.
 * Telegram supports: <b>, <i>, <u>, <s>, <code>, <pre>, <a href="">
 */
export const markdownToHtml = (text: string): string => {
    // Escape HTML special chars first (order matters)
    let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    // Fenced code blocks (``` ... ```) — before inline code
    html = html.replace(/```(?:\w+)?\n?([\s\S]*?)```/g, (_, code: string) => `<pre><code>${code.trimEnd()}</code></pre>`)

    // Inline code
    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>')

    // Bold — **text** or __text__
    html = html.replace(/\*\*(.+?)\*\*/gs, '<b>$1</b>')
    html = html.replace(/__(.+?)__/gs, '<b>$1</b>')

    // Italic — *text* or _text_ (single, not already bold)
    html = html.replace(/\*([^*\n]+?)\*/g, '<i>$1</i>')
    html = html.replace(/_([^_\n]+?)_/g, '<i>$1</i>')

    // Strikethrough — ~~text~~
    html = html.replace(/~~(.+?)~~/gs, '<s>$1</s>')

    // Links — [text](url)
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>')

    return html
}
