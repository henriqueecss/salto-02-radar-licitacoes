export type TelegramOptions = {
  token: string;
  chatId: string;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

const MAX_ATTEMPTS = 3;
// O Telegram limita cerca de 1 mensagem por segundo no mesmo chat.
const DELAY_BETWEEN_MESSAGES_MS = 1_100;

type TelegramResponse = { ok: boolean; description?: string; parameters?: { retry_after?: number } };

// Erros de rede podem trazer a URL, e a URL do Bot API contem o token.
function redact(text: string, token: string): string {
  return token ? text.split(token).join("***") : text;
}

async function sendOne(text: string, opts: Required<TelegramOptions>): Promise<void> {
  const url = `https://api.telegram.org/bot${opts.token}/sendMessage`;
  const body = JSON.stringify({
    chat_id: opts.chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });

  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await opts.fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      if (attempt < MAX_ATTEMPTS) {
        await opts.sleep(2_000 * attempt);
        continue;
      }
      throw new Error(`Telegram: falha de rede (${redact((error as Error).message, opts.token)})`);
    }

    if (res.ok) return;
    const data = (await res.json().catch(() => ({}))) as TelegramResponse;
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt < MAX_ATTEMPTS) {
      await opts.sleep((data.parameters?.retry_after ?? 2 * attempt) * 1_000);
      continue;
    }
    throw new Error(`Telegram: HTTP ${res.status} (${redact(data.description ?? "sem descricao", opts.token)})`);
  }
}

export async function sendMessages(messages: string[], options: TelegramOptions): Promise<void> {
  const opts: Required<TelegramOptions> = {
    fetchFn: fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    ...options,
  };
  for (const [i, message] of messages.entries()) {
    if (i > 0) await opts.sleep(DELAY_BETWEEN_MESSAGES_MS);
    await sendOne(message, opts);
  }
}
