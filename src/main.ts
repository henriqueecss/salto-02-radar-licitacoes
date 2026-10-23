import { existsSync } from "node:fs";
import { loadConfig } from "./config.ts";
import { runRadar } from "./pipeline.ts";
import { fetchOpenContratacoes } from "./pncp/client.ts";
import { openStore } from "./store/db.ts";
import { sendMessages } from "./telegram/client.ts";

if (existsSync(".env")) process.loadEnvFile(".env");

const config = loadConfig(process.env);
const store = openStore(config.dbPath);

try {
  const result = await runRadar({
    config,
    now: new Date(),
    fetchContratacoes: fetchOpenContratacoes,
    send: config.dryRun
      ? async (messages) => messages.forEach((m) => console.log(`${m}\n`))
      : (messages) => sendMessages(messages, { token: config.telegramToken, chatId: config.telegramChatId }),
    store,
    log: console.log,
    dryRun: config.dryRun,
  });
  console.log(`concluido: ${result.novos} edital(is) novo(s) enviado(s)`);
} finally {
  store.close();
}
