import "dotenv/config";
import { createBot } from "./bot.js";

const bot = createBot();
bot.start();

console.log("Jellyfish AI bot started.");

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  console.log(`Received ${signal}. Stopping bot...`);
  bot.stop();
};

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});
process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});
