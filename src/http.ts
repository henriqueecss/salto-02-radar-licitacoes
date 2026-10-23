export type RetryOptions = {
  timeoutMs: number;
  maxAttempts: number;
  baseDelayMs: number;
  // O PNCP devolve 429 depois de poucas paginas seguidas (visto em 23/10/2026);
  // a janela do limite e bem maior que a de uma falha comum.
  rateLimitDelayMs: number;
  pageDelayMs: number;
  sleep: (ms: number) => Promise<void>;
};

export const defaultRetry: RetryOptions = {
  timeoutMs: 30_000,
  maxAttempts: 5,
  baseDelayMs: 1_000,
  rateLimitDelayMs: 10_000,
  pageDelayMs: 1_000,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

// Um Retry-After maior que isso e cota diaria esgotada, nao pico de trafego: esperar nao resolve.
const MAX_RETRY_AFTER_MS = 120_000;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    url: string,
    readonly retryAfterMs: number | null = null,
  ) {
    super(`HTTP ${status} em ${url}`);
  }
}

function parseRetryAfter(res: Response): number | null {
  const seconds = Number(res.headers.get("retry-after"));
  return res.headers.has("retry-after") && Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : null;
}

function retryDelay(error: unknown, attempt: number, opts: RetryOptions): number {
  const backoff = 2 ** (attempt - 1);
  if (error instanceof HttpError && error.status === 429) {
    return error.retryAfterMs ?? opts.rateLimitDelayMs * backoff;
  }
  return opts.baseDelayMs * backoff + Math.random() * opts.baseDelayMs * 0.5;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof HttpError) {
    if (error.status === 429) return (error.retryAfterMs ?? 0) <= MAX_RETRY_AFTER_MS;
    return error.status >= 500;
  }
  // TypeError: falha de rede no fetch; TimeoutError/AbortError: estouro do AbortSignal.timeout
  return error instanceof Error && ["TypeError", "TimeoutError", "AbortError"].includes(error.name);
}

export async function fetchWithRetry(
  url: string,
  fetchFn: typeof fetch,
  opts: RetryOptions,
  init: RequestInit = {},
): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs) });
      if (res.status === 204) return null;
      if (!res.ok) throw new HttpError(res.status, url, parseRetryAfter(res));
      return await res.json();
    } catch (error) {
      if (attempt >= opts.maxAttempts || !isRetryable(error)) throw error;
      const delay = retryDelay(error, attempt, opts);
      console.warn(`tentativa ${attempt} falhou (${(error as Error).message}); nova tentativa em ${Math.round(delay)} ms`);
      await opts.sleep(delay);
    }
  }
}
