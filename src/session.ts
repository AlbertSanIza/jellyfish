import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

export type SessionRole = "system" | "user" | "assistant";

export interface SessionMessage {
  role: SessionRole;
  content: string;
  timestamp: string;
}

const baseDir = path.join(os.homedir(), ".jellyfish");
const sessionsDir = path.join(baseDir, "sessions");

const getSessionPath = (chatId: string): string =>
  path.join(sessionsDir, `${chatId}.json`);

const ensureSessionsDir = async (): Promise<void> => {
  await fs.mkdir(sessionsDir, { recursive: true });
};

export const loadSession = async (chatId: string): Promise<SessionMessage[]> => {
  await ensureSessionsDir();
  const sessionPath = getSessionPath(chatId);

  try {
    const raw = await fs.readFile(sessionPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is SessionMessage => {
      if (typeof item !== "object" || item === null) {
        return false;
      }

      const candidate = item as Record<string, unknown>;
      return (
        (candidate.role === "system" ||
          candidate.role === "user" ||
          candidate.role === "assistant") &&
        typeof candidate.content === "string" &&
        typeof candidate.timestamp === "string"
      );
    });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

export const saveSession = async (
  chatId: string,
  messages: SessionMessage[],
): Promise<void> => {
  await ensureSessionsDir();
  const sessionPath = getSessionPath(chatId);
  await fs.writeFile(sessionPath, JSON.stringify(messages, null, 2), "utf8");
};

export const clearSession = async (chatId: string): Promise<void> => {
  await ensureSessionsDir();
  const sessionPath = getSessionPath(chatId);
  try {
    await fs.unlink(sessionPath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      throw error;
    }
  }
};
