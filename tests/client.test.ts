import { describe, expect, it, vi } from "vitest";
import { fetchOpenContratacoes, fetchWithRetry, type RetryOptions } from "../src/pncp/client.ts";
import { loadFixture } from "./helpers.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const noSleep = { sleep: vi.fn(async () => {}) };
const retry = (o: Partial<RetryOptions> = {}): RetryOptions => ({
  timeoutMs: 1000,
  maxAttempts: 4,
  baseDelayMs: 1000,
  ...noSleep,
  ...o,
});

describe("fetchWithRetry", () => {
  it("devolve o JSON na primeira tentativa bem-sucedida", async () => {
    const fetchFn = vi.fn(async () => json({ ok: 1 }));
    await expect(fetchWithRetry("http://x", fetchFn, retry())).resolves.toEqual({ ok: 1 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("repete em 5xx, 429 e erro de rede, com backoff crescente", async () => {
    const sleep = vi.fn(async () => {});
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({}, 503))
      .mockResolvedValueOnce(json({}, 429))
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(json({ ok: 1 }));
    await expect(fetchWithRetry("http://x", fetchFn, retry({ sleep }))).resolves.toEqual({ ok: 1 });
    expect(fetchFn).toHaveBeenCalledTimes(4);
    const delays = sleep.mock.calls.map((c: unknown[]) => c[0] as number);
    expect(delays).toHaveLength(3);
    expect(delays[0]).toBeGreaterThanOrEqual(1000);
    expect(delays[1]).toBeGreaterThanOrEqual(2000);
    expect(delays[2]).toBeGreaterThanOrEqual(4000);
  });

  it("repete quando a requisicao estoura o timeout", async () => {
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    const fetchFn = vi.fn<typeof fetch>().mockImplementationOnce(hang).mockResolvedValueOnce(json({ ok: 1 }));
    await expect(fetchWithRetry("http://x", fetchFn, retry({ timeoutMs: 10 }))).resolves.toEqual({ ok: 1 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("desiste depois do numero maximo de tentativas", async () => {
    const fetchFn = vi.fn(async () => json({}, 500));
    await expect(fetchWithRetry("http://x", fetchFn, retry({ maxAttempts: 3 }))).rejects.toThrow(/HTTP 500/);
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("nao repete erro 4xx", async () => {
    const fetchFn = vi.fn(async () => json({}, 400));
    await expect(fetchWithRetry("http://x", fetchFn, retry())).rejects.toThrow(/HTTP 400/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("204 sem conteudo vira null", async () => {
    const fetchFn = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(fetchWithRetry("http://x", fetchFn, retry())).resolves.toBeNull();
  });
});

describe("fetchOpenContratacoes", () => {
  const p1 = loadFixture("proposta-mg-mod6-p1.json");
  const p2 = { ...loadFixture("proposta-mg-mod6-p2.json"), totalPaginas: 2, paginasRestantes: 0 };
  const mod8 = { ...loadFixture("proposta-mg-mod8-p1.json"), totalPaginas: 1, paginasRestantes: 0 };

  it("percorre todas as paginas de cada modalidade com os parametros certos", async () => {
    const urls: URL[] = [];
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      urls.push(url);
      const mod = url.searchParams.get("codigoModalidadeContratacao");
      const page = url.searchParams.get("pagina");
      if (mod === "6") return json(page === "1" ? { ...p1, totalPaginas: 2, paginasRestantes: 1 } : p2);
      if (mod === "8") return json(mod8);
      return new Response(null, { status: 204 });
    });

    const result = await fetchOpenContratacoes({
      uf: "MG",
      modalidades: [6, 8, 4],
      dataFinal: "20271023",
      fetchFn,
      retry: retry(),
    });

    expect(result).toHaveLength(30);
    expect(urls).toHaveLength(4);
    expect(urls.map((u) => [u.searchParams.get("codigoModalidadeContratacao"), u.searchParams.get("pagina")])).toEqual([
      ["6", "1"],
      ["6", "2"],
      ["8", "1"],
      ["4", "1"],
    ]);
    for (const u of urls) {
      expect(u.pathname).toBe("/api/consulta/v1/contratacoes/proposta");
      expect(u.searchParams.get("uf")).toBe("MG");
      expect(u.searchParams.get("tamanhoPagina")).toBe("50");
      expect(u.searchParams.get("dataFinal")).toBe("20271023");
    }
  });

  it("falha a coleta inteira se uma pagina falhar de vez", async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const page = new URL(String(input)).searchParams.get("pagina");
      return page === "1" ? json({ ...p1, totalPaginas: 2, paginasRestantes: 1 }) : json({}, 502);
    });
    await expect(
      fetchOpenContratacoes({ uf: "MG", modalidades: [6], dataFinal: "20271023", fetchFn, retry: retry() }),
    ).rejects.toThrow(/HTTP 502/);
  });
});
