export type Config = {
  uf: string;
  valorMin: number;
  valorMax: number | null;
  modalidades: number[];
  dbPath: string;
  dryRun: boolean;
  telegramToken: string;
  telegramChatId: string;
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

  return {
    uf: (env.RADAR_UF?.trim() || "MG").toUpperCase(),
    valorMin: parseNumber(env, "RADAR_VALOR_MINIMO") ?? 0,
    valorMax: parseNumber(env, "RADAR_VALOR_MAXIMO"),
    modalidades,
    dbPath: env.RADAR_DB_PATH?.trim() || "state/radar.db",
    dryRun,
    telegramToken,
    telegramChatId,
  };
}
