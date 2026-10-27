import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { RetryOptions } from "../src/http.ts";
import { buildRequest, classifyAll, MAX_OUTPUT_TOKENS, parseVerdicts, SYSTEM_PROMPT, type LlmConfig } from "../src/llm/classify.ts";

const config: LlmConfig = { apiKey: "chave-de-teste", baseUrl: "https://llm.test/v1", model: "modelo-x" };

const retry = (o: Partial<RetryOptions> = {}): RetryOptions => ({
  timeoutMs: 1000,
  maxAttempts: 2,
  baseDelayMs: 1,
  rateLimitDelayMs: 1,
  pageDelayMs: 0,
  sleep: vi.fn(async () => {}),
  ...o,
});

// Resposta no formato /chat/completions, que Groq, GitHub Models e OpenRouter seguem.
const chat = (content: string, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }), {
    status,
    headers: { "content-type": "application/json" },
  });

const verdicts = (n: number, relevante = true) =>
  JSON.stringify({ itens: Array.from({ length: n }, (_, i) => ({ id: String(i + 1), relevante, motivo: `m${i + 1}` })) });

const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `edital-${i + 1}`, objeto: `objeto ${i + 1}` }));

const sentObjetos = (call: Parameters<typeof fetch>) => {
  const body = JSON.parse(String(call[1]?.body));
  return JSON.parse(body.messages[1].content) as { id: string; objeto: string }[];
};

describe("SYSTEM_PROMPT", () => {
  // Erros vistos em producao em 26 e 27/10/2026; o efeito real e medido com `npm run evaluate -- <csv> --llm`.
  it("deixa fora operacao de infraestrutura de TIC e consultoria sem software", () => {
    expect(SYSTEM_PROMPT).toMatch(/infraestrutura de TIC/);
    expect(SYSTEM_PROMPT).toMatch(/consultoria/i);
    expect(SYSTEM_PROMPT).toMatch(/LGPD/);
  });

  it("aceita infraestrutura quando o texto pede desenvolvimento ou evolucao de software", () => {
    expect(SYSTEM_PROMPT).toMatch(/a menos que peça desenvolvimento ou evolução de software/);
  });

  it("mantem relevante a evolucao de sistema que o orgao ja usa", () => {
    expect(SYSTEM_PROMPT).toMatch(/sistema que o órgão já usa/);
  });
});

describe("buildRequest", () => {
  it("manda o perfil da empresa no sistema e os objetos com ids curtos", () => {
    const req = buildRequest(["Desenvolvimento de site", "Pneus"], "modelo-x");
    expect(req.model).toBe("modelo-x");
    expect(req.temperature).toBe(0);
    expect(req.response_format).toEqual({ type: "json_object" });
    // Sem teto, o Groq estima a saida pelo pior caso e recusa o pedido no plano gratuito.
    expect(req.max_tokens).toBe(MAX_OUTPUT_TOKENS);
    expect(req.messages[0]?.role).toBe("system");
    expect(req.messages[0]?.content).toMatch(/software house/);
    expect(JSON.parse(req.messages[1]?.content ?? "")).toEqual([
      { id: "1", objeto: "Desenvolvimento de site" },
      { id: "2", objeto: "Pneus" },
    ]);
  });

  it("tira o prefixo da plataforma de disputa antes de mandar", () => {
    const req = buildRequest(["[Portal de Compras Públicas] - Manutenção de drenagem"], "m");
    expect(JSON.parse(req.messages[1]?.content ?? "")[0].objeto).toBe("Manutenção de drenagem");
  });
});

describe("parseVerdicts", () => {
  it("le o veredito de cada id", () => {
    const parsed = parseVerdicts(
      JSON.stringify({ itens: [{ id: "1", relevante: true, motivo: "site" }, { id: "2", relevante: false, motivo: "pneu" }] }),
      2,
    );
    expect(parsed.get(0)).toEqual({ relevante: true, motivo: "site" });
    expect(parsed.get(1)).toEqual({ relevante: false, motivo: "pneu" });
  });

  it("ignora id fora do lote e item malformado, sem inventar veredito", () => {
    const parsed = parseVerdicts(
      JSON.stringify({
        itens: [
          { id: "9", relevante: true, motivo: "x" },
          { id: "1", relevante: "sim", motivo: "x" },
          { id: "2", relevante: false },
        ],
      }),
      2,
    );
    expect(parsed.size).toBe(1);
    expect(parsed.get(1)).toEqual({ relevante: false, motivo: "" });
  });

  it("falha se a resposta nao for JSON", () => {
    expect(() => parseVerdicts("Claro! Aqui esta:", 1)).toThrow();
  });

  it("interpreta uma resposta real gravada do Groq", () => {
    const recorded = JSON.parse(readFileSync("tests/fixtures/llm-groq-lote.json", "utf8"));
    const sent = JSON.parse(recorded.request.messages[1].content) as unknown[];
    const parsed = parseVerdicts(recorded.response.choices[0].message.content, sent.length);
    expect(parsed.size).toBe(sent.length);
    // Ids do conjunto rotulado: R = relevante, I = irrelevante (abastecimento de agua, licenca, diario oficial).
    const ids = recorded.ids as string[];
    ids.forEach((id, i) => {
      expect(parsed.get(i)?.relevante).toBe(id.startsWith("R"));
      expect(parsed.get(i)?.motivo.length).toBeGreaterThan(0);
    });
  });
});

describe("classifyAll", () => {
  it("divide em lotes, autentica e devolve o veredito pelo id do edital", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => chat(verdicts(2)));
    const result = await classifyAll(items(5), { config, fetchFn, retry: retry(), log: () => {}, batchSize: 2 });

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(fetchFn.mock.calls.map(sentObjetos).map((l) => l.length)).toEqual([2, 2, 1]);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://llm.test/v1/chat/completions");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer chave-de-teste");
    expect(result.size).toBe(5);
    expect(result.get("edital-5")).toEqual({ relevante: true, motivo: "m1" });
  });

  it("pausa entre lotes para respeitar o limite de tokens por minuto", async () => {
    const sleep = vi.fn(async () => {});
    const fetchFn = vi.fn<typeof fetch>(async () => chat(verdicts(2)));
    await classifyAll(items(4), { config, fetchFn, retry: retry({ sleep, pageDelayMs: 15_000 }), log: () => {}, batchSize: 2 });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(15_000);
  });

  it("se a API falhar de vez, para e devolve o que ja foi classificado", async () => {
    const log = vi.fn();
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(chat(verdicts(2)))
      .mockResolvedValue(chat("", 401));
    const result = await classifyAll(items(6), { config, fetchFn, retry: retry(), log, batchSize: 2 });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect([...result.keys()]).toEqual(["edital-1", "edital-2"]);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/HTTP 401/));
  });

  it("resposta que nao e JSON perde so aquele lote", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(chat("nao sei responder"))
      .mockResolvedValueOnce(chat(verdicts(2)));
    const result = await classifyAll(items(4), { config, fetchFn, retry: retry(), log: () => {}, batchSize: 2 });
    expect([...result.keys()]).toEqual(["edital-3", "edital-4"]);
  });

  it("HTTP 400 (o provedor recusou o JSON gerado) perde so aquele lote", async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(chat(JSON.stringify({ error: { code: "json_validate_failed" } }), 400))
      .mockResolvedValueOnce(chat(verdicts(2)));
    const result = await classifyAll(items(4), { config, fetchFn, retry: retry(), log: () => {}, batchSize: 2 });
    expect([...result.keys()]).toEqual(["edital-3", "edital-4"]);
  });

  it("nunca escreve a chave no log", async () => {
    const log = vi.fn();
    const fetchFn = vi.fn<typeof fetch>(async () => chat("", 500));
    await classifyAll(items(1), { config, fetchFn, retry: retry(), log });
    expect(log).toHaveBeenCalled();
    for (const [message] of log.mock.calls) expect(String(message)).not.toContain(config.apiKey);
  });

  it("lista vazia nao chama a API", async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const result = await classifyAll([], { config, fetchFn, retry: retry(), log: () => {} });
    expect(result.size).toBe(0);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
