import { query } from "@anthropic-ai/claude-agent-sdk";
import { customMemoryTools } from "./tools.js";
import { loadSession, saveSession, type SessionMessage } from "./session.js";

type OnChunk = (partialText: string) => Promise<void> | void;

const BUILTIN_TOOLS = ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebFetch"] as const;

const nowIso = (): string => new Date().toISOString();

const systemPrompt = (): string => {
  const now = new Date();
  return [
    "You are Jellyfish, a helpful personal AI assistant for Telegram.",
    "Be concise, useful, and proactive.",
    `Current date/time: ${now.toISOString()} (${now.toString()})`,
  ].join("\n");
};

const toSdkMessages = (messages: SessionMessage[]): Array<{ role: string; content: string }> =>
  messages.map((message) => ({ role: message.role, content: message.content }));

const getTextFromEvent = (event: unknown): string => {
  if (typeof event === "string") {
    return event;
  }
  if (typeof event !== "object" || event === null) {
    return "";
  }

  const record = event as Record<string, unknown>;
  const directText = record.text;
  if (typeof directText === "string") {
    return directText;
  }

  const delta = record.delta;
  if (typeof delta === "string") {
    return delta;
  }
  if (typeof delta === "object" && delta !== null) {
    const deltaText = (delta as Record<string, unknown>).text;
    if (typeof deltaText === "string") {
      return deltaText;
    }
  }

  return "";
};

export const runAgent = async (
  chatId: string,
  messageText: string,
  onChunk?: OnChunk,
): Promise<string> => {
  const session = await loadSession(chatId);
  const userMessage: SessionMessage = {
    role: "user",
    content: messageText,
    timestamp: nowIso(),
  };

  const draftSession = [...session, userMessage];
  let finalText = "";

  try {
    const response = await query({
      prompt: messageText,
      systemPrompt: systemPrompt(),
      messageHistory: toSdkMessages(draftSession),
      tools: [...BUILTIN_TOOLS, ...customMemoryTools] as unknown,
      permissionMode: "bypassPermissions",
      options: {
        stream: true,
      },
    } as never);

    for await (const event of response as AsyncIterable<unknown>) {
      const chunk = getTextFromEvent(event);
      if (!chunk) {
        continue;
      }
      finalText += chunk;
      if (onChunk) {
        await onChunk(finalText);
      }
    }

    if (!finalText.trim()) {
      finalText = "I could not generate a response.";
    }

    const assistantMessage: SessionMessage = {
      role: "assistant",
      content: finalText,
      timestamp: nowIso(),
    };
    await saveSession(chatId, [...draftSession, assistantMessage]);
    return finalText;
  } catch (error) {
    await saveSession(chatId, draftSession);
    throw error;
  }
};
