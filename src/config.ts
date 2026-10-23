import type { LlmConfig } from "./llm/classify.ts";

export const DEFAULT_LLM_BASE_URL = "https://api.groq.com/openai/v1";
export const DEFAULT_LLM_MODEL = "qwen/qwen3.8-27b";

export type Config = {
  uf: string;
  valorMin: number;
  valorMax: number | null;
  modalidades: number[];
  dbPath: string;
  dryRun: boolean;
  telegramToken: string;
  telegramChatId: string;
  // null: sem API_KEY, o filtro usa so as regras
  llm: LlmConfig | null;
};

type Env = Record<string, string | undefined>;

function parseNumber(env: Env, name: string): number | null {
  const raw = env[name]?.trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} invalido: "${raw}"`);
  return value;
}

export function loadConfig(env: Env): Config {
  const dryRun = env.RADAR_DRY_RUN === "1";
  const telegramToken = env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const telegramChatId = env.TELEGRAM_CHAT_ID?.trim() ?? "";
  if (!dryRun && (!telegramToken || !telegramChatId)) {
    throw new Error("Defina TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID (ou RADAR_DRY_RUN=1 para so imprimir)");
  }

  const modalidades = (env.RADAR_MODALIDADES?.trim() || "6,8,4").split(",").map((m) => Number(m.trim()));
  if (modalidades.some((m) => !Number.isInteger(m) || m < 1)) {
    throw new Error(`RADAR_MODALIDADES invalido: "${env.RADAR_MODALIDADES}"`);
  }

  const apiKey = env.API_KEY?.trim() ?? "";
  const llm = apiKey
    ? {
        apiKey,
        baseUrl: (env.LLM_BASE_URL?.trim() || DEFAULT_LLM_BASE_URL).replace(/\/+$/, ""),
        model: env.LLM_MODEL?.trim() || DEFAULT_LLM_MODEL,
      }
    : null;

  return {
    uf: (env.RADAR_UF?.trim() || "MG").toUpperCase(),
    valorMin: parseNumber(env, "RADAR_VALOR_MINIMO") ?? 0,
    valorMax: parseNumber(env, "RADAR_VALOR_MAXIMO"),
    modalidades,
    dbPath: env.RADAR_DB_PATH?.trim() || "state/radar.db",
    dryRun,
    telegramToken,
    telegramChatId,
    llm,
  };
}
