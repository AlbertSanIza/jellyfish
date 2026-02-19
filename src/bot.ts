import { Bot, Context } from "grammy";
import { runAgent } from "./agent.js";
import { clearSession, loadSession } from "./session.js";

const parseAllowedChatIds = (value: string | undefined): Set<string> => {
  if (!value) {
    return new Set<string>();
  }
  return new Set(
    value
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
};

const isAllowedChat = (chatId: string, allowlist: Set<string>): boolean =>
  allowlist.has(chatId);

const safeEditMessage = async (
  bot: Bot,
  chatId: number,
  messageId: number,
  text: string,
): Promise<void> => {
  try {
    await bot.api.editMessageText(chatId, messageId, text);
  } catch (error) {
    const err = error as { description?: string };
    if (typeof err.description === "string" && err.description.includes("message is not modified")) {
      return;
    }
    throw error;
  }
};

const startTypingLoop = (ctx: Context): NodeJS.Timeout =>
  setInterval(() => {
    void ctx.replyWithChatAction("typing");
  }, 4000);

export const createBot = (): Bot => {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    throw new Error("Missing BOT_TOKEN");
  }

  const allowedChats = parseAllowedChatIds(process.env.ALLOWED_CHAT_IDS);
  const bot = new Bot(token);

  bot.command("new", async (ctx) => {
    const chatId = String(ctx.chat?.id ?? "");
    if (!chatId) {
      return;
    }
    if (!isAllowedChat(chatId, allowedChats)) {
      await ctx.reply("Access denied.");
      return;
    }

    await clearSession(chatId);
    await ctx.reply("Session cleared! Fresh start 🪼");
  });

  bot.command("status", async (ctx) => {
    const chatId = String(ctx.chat?.id ?? "");
    if (!chatId) {
      return;
    }
    if (!isAllowedChat(chatId, allowedChats)) {
      await ctx.reply("Access denied.");
      return;
    }

    const messages = await loadSession(chatId);
    await ctx.reply(`Session has ${messages.length} messages.`);
  });

  bot.on("message:text", async (ctx) => {
    const chatIdNumber = ctx.chat.id;
    const chatId = String(chatIdNumber);
    const text = ctx.message.text;

    if (!isAllowedChat(chatId, allowedChats)) {
      await ctx.reply("Access denied.");
      return;
    }

    const typingLoop = startTypingLoop(ctx);
    await ctx.replyWithChatAction("typing");

    let draftMessageId: number | undefined;
    let lastSentText = "";
    let lastUpdateMs = 0;

    try {
      const draft = await ctx.reply("Thinking...");
      draftMessageId = draft.message_id;

      const finalText = await runAgent(chatId, text, async (partialText) => {
        if (!draftMessageId) {
          return;
        }

        const now = Date.now();
        if (partialText === lastSentText) {
          return;
        }
        if (now - lastUpdateMs < 700) {
          return;
        }

        await safeEditMessage(bot, chatIdNumber, draftMessageId, partialText);
        lastSentText = partialText;
        lastUpdateMs = now;
      });

      if (draftMessageId) {
        await safeEditMessage(bot, chatIdNumber, draftMessageId, finalText);
      } else {
        await ctx.reply(finalText);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const visibleError = `Agent error: ${message}`;
      if (draftMessageId) {
        await safeEditMessage(bot, chatIdNumber, draftMessageId, visibleError);
      } else {
        await ctx.reply(visibleError);
      }
      console.error("Agent execution failed:", error);
    } finally {
      clearInterval(typingLoop);
    }
  });

  bot.catch((error) => {
    console.error("Telegram bot error:", error.error);
  });

  return bot;
};
