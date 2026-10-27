import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LLM_MODEL, loadConfig } from "../src/config.ts";
import { hasItVocabulary, isRelevant } from "../src/filter/relevance.ts";
import type { LlmItem, Verdict } from "../src/llm/classify.ts";
import { runRadar, type RadarDeps } from "../src/pipeline.ts";
import type { PncpContratacao } from "../src/pncp/normalize.ts";
import { openStore } from "../src/store/db.ts";
import { loadFixture, rawContratacao } from "./helpers.ts";

const now = new Date("2026-10-23T11:00:00Z");

// Fixtures reais (nenhuma e de software) mais dois editais relevantes sinteticos e um de outra situacao.
const relevant = [
  rawContratacao({ numeroControlePNCP: "18338152000164-1-000901/2026", objetoCompra: "DESENVOLVIMENTO DE APLICATIVO MÓVEL" }),
  rawContratacao({ numeroControlePNCP: "18338152000164-1-000902/2026", objetoCompra: "Fábrica de software (UST)" }),
];
const suspended = rawContratacao({
  numeroControlePNCP: "18338152000164-1-000903/2026",
  objetoCompra: "Desenvolvimento de sistema web",
  situacaoCompraId: 3,
});
const collected: PncpContratacao[] = [
  ...loadFixture("proposta-mg-mod6-p1.json").data,
  ...loadFixture("proposta-mg-mod8-p1.json").data,
  ...relevant,
  suspended,
];

const deps = (overrides: Partial<RadarDeps> = {}): RadarDeps => ({
  config: { uf: "MG", valorMin: 0, valorMax: null, modalidades: [6, 8, 4] },
  now,
  fetchContratacoes: vi.fn(async () => collected),
  send: vi.fn(async () => {}),
  store: openStore(":memory:"),
  log: () => {},
  ...overrides,
});

describe("runRadar", () => {
  it("coleta, filtra, envia o resumo e grava o que foi enviado", async () => {
    const d = deps();
    const result = await runRadar(d);

    expect(result).toEqual({ coletados: collected.length, novos: 2 });
    const [messages] = vi.mocked(d.send).mock.calls[0] ?? [];
    expect(messages).toHaveLength(1);
    expect(messages?.[0]).toContain("2 editais novos");
    expect(messages?.[0]).toContain("DESENVOLVIMENTO DE APLICATIVO MÓVEL");
    expect(messages?.[0]).not.toContain("KIT ENXOVAL");
    expect(d.store.count()).toBe(2);
  });

  it("pede a coleta com UF, modalidades e data final um ano a frente", async () => {
    const d = deps();
    await runRadar(d);
    expect(d.fetchContratacoes).toHaveBeenCalledWith({ uf: "MG", modalidades: [6, 8, 4], dataFinal: "20271023" });
  });

  it("na segunda execucao nao reenvia e avisa que nao ha nada novo", async () => {
    const store = openStore(":memory:");
    await runRadar(deps({ store }));
    const send = vi.fn(async (_messages: string[]) => {});
    const result = await runRadar(deps({ store, send }));

    expect(result.novos).toBe(0);
    expect(send.mock.calls[0]?.[0]).toEqual([expect.stringContaining("Nenhum edital novo hoje")]);
  });

  it("se o envio falhar nada e gravado, para reenviar na proxima execucao", async () => {
    const d = deps({ send: vi.fn(async () => Promise.reject(new Error("Telegram fora"))) });
    await expect(runRadar(d)).rejects.toThrow("Telegram fora");
    expect(d.store.count()).toBe(0);
  });

  it("se a coleta falhar nada e enviado nem gravado", async () => {
    const d = deps({ fetchContratacoes: vi.fn(async () => Promise.reject(new Error("HTTP 502"))) });
    await expect(runRadar(d)).rejects.toThrow("HTTP 502");
    expect(d.send).not.toHaveBeenCalled();
    expect(d.store.count()).toBe(0);
  });

  it("o mesmo edital publicado duas vezes chega uma vez so", async () => {
    const original = rawContratacao({
      numeroControlePNCP: "19193527000108-1-000055/2026",
      objetoCompra: "Manutenção evolutiva do sistema web e-Cidade",
      valorTotalEstimado: 13100481.34,
    });
    const republished = rawContratacao({
      numeroControlePNCP: "19193527000108-1-000056/2026",
      objetoCompra: "[Portal de Compras Públicas] - MANUTENÇÃO EVOLUTIVA DO SISTEMA WEB E-CIDADE",
      valorTotalEstimado: 13100481.34,
    });
    const d = deps({ fetchContratacoes: vi.fn(async () => [original, republished]) });
    const result = await runRadar(d);

    expect(result.novos).toBe(1);
    expect(d.store.count()).toBe(1);
    expect(vi.mocked(d.send).mock.calls[0]?.[0]?.[0]).toContain("1 edital novo");
  });

  it("em modo dry-run imprime em vez de gravar", async () => {
    const d = deps({ dryRun: true });
    await runRadar(d);
    expect(d.send).toHaveBeenCalled();
    expect(d.store.count()).toBe(0);
  });
});

describe("runRadar com LLM", () => {
  // As regras perdem a bilheteria (sem termo forte) e aprovam a frota (por "aplicativos moveis").
  const ticketing = rawContratacao({
    numeroControlePNCP: "21461546000110-1-000134/2026",
    objetoCompra: "Plataforma para venda de bilhetes da festa municipal",
  });
  const fleet = rawContratacao({
    numeroControlePNCP: "00444232000139-1-001259/2026",
    objetoCompra: "Gerenciamento de frota com cartões e aplicativos móveis",
  });
  const withLlm = [...collected, ticketing, fleet];

  const judge = (items: LlmItem[]) =>
    new Map<string, Verdict>(
      items.map((i) => {
        const relevante = /bilhetes|aplicativo móvel|fábrica de software/i.test(i.objeto);
        return [i.id, { relevante, motivo: relevante ? "software" : "fora do perfil" }];
      }),
    );

  const llmDeps = (overrides: Partial<RadarDeps> = {}) =>
    deps({
      fetchContratacoes: vi.fn(async () => withLlm),
      llm: { model: "modelo-x", classify: vi.fn(async (items: LlmItem[]) => judge(items)) },
      ...overrides,
    });

  it("recupera o que as regras perderam e corta o falso positivo", async () => {
    const d = llmDeps();
    const result = await runRadar(d);

    const [messages = []] = vi.mocked(d.send).mock.calls[0] ?? [];
    const text = messages.join("\n");
    expect(text).toContain("Plataforma para venda de bilhetes");
    expect(text).toContain("Motivo: software");
    expect(text).not.toContain("Gerenciamento de frota");
    expect(result.novos).toBe(3);
  });

  it("so manda ao LLM o que tem vocabulario de TI ou passou nas regras", async () => {
    const d = llmDeps();
    await runRadar(d);
    const [sent = []] = vi.mocked(d.llm!.classify).mock.calls[0] ?? [];
    const ids = sent.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining([ticketing.numeroControlePNCP, fleet.numeroControlePNCP]));
    expect(ids).not.toContain(suspended.numeroControlePNCP);
    expect(sent.every((i) => hasItVocabulary(i.objeto) || isRelevant(i.objeto))).toBe(true);
    expect(sent.length).toBeLessThan(withLlm.length / 2);
  });

  it("na segunda execucao usa a classificacao guardada em vez de chamar o LLM de novo", async () => {
    const store = openStore(":memory:");
    await runRadar(llmDeps({ store }));
    const classify = vi.fn(async (items: LlmItem[]) => judge(items));
    const send = vi.fn(async (_messages: string[]) => {});
    const result = await runRadar(llmDeps({ store, send, llm: { model: "modelo-x", classify } }));

    expect(classify).not.toHaveBeenCalled();
    expect(result.novos).toBe(0);
  });

  it("limita os editais julgados por execucao, com os aprovados pelas regras primeiro", async () => {
    const classify = vi.fn(async (items: LlmItem[]) => judge(items));
    const d = llmDeps({ llm: { model: "m", classify, maxPerRun: 3 } });
    await runRadar(d);

    const [sent = []] = classify.mock.calls[0] ?? [];
    expect(sent).toHaveLength(3);
    expect(sent.every((i) => isRelevant(i.objeto))).toBe(true);
  });

  it("o que ficou para depois e julgado na execucao seguinte", async () => {
    const store = openStore(":memory:");
    await runRadar(llmDeps({ store, llm: { model: "m", classify: vi.fn(async (i: LlmItem[]) => judge(i)), maxPerRun: 3 } }));
    const classify = vi.fn(async (items: LlmItem[]) => judge(items));
    await runRadar(llmDeps({ store, llm: { model: "m", classify } }));

    const [sent = []] = classify.mock.calls[0] ?? [];
    const ids = sent.map((i) => i.id);
    expect(ids).toContain(ticketing.numeroControlePNCP);
    // a frota foi julgada (e rejeitada) na primeira execucao: o veredito vem do cache
    expect(ids).not.toContain(fleet.numeroControlePNCP);
  });

  it("edital sem veredito do LLM fica com a decisao das regras", async () => {
    const d = llmDeps({ llm: { model: "m", classify: vi.fn(async () => new Map<string, Verdict>()) } });
    const result = await runRadar(d);
    const text = (vi.mocked(d.send).mock.calls[0]?.[0] ?? []).join("\n");
    expect(text).toContain("Gerenciamento de frota");
    expect(text).not.toContain("Plataforma para venda de bilhetes");
    expect(result.novos).toBe(3);
  });

  it("erro inesperado no LLM nao derruba o job: vale a decisao das regras", async () => {
    const log = vi.fn();
    const d = llmDeps({ log, llm: { model: "m", classify: vi.fn(async () => Promise.reject(new Error("quebrou"))) } });
    const result = await runRadar(d);
    expect(result.novos).toBe(3);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/quebrou/));
  });

  it("em dry-run nao grava as classificacoes", async () => {
    const d = llmDeps({ dryRun: true });
    await runRadar(d);
    expect(d.store.getVerdicts([ticketing.numeroControlePNCP]).size).toBe(0);
  });
});

describe("loadConfig", () => {
  it("usa MG, modalidades 6, 8 e 4 e sem limite de valor por padrao", () => {
    const c = loadConfig({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "c" });
    expect(c).toMatchObject({ uf: "MG", valorMin: 0, valorMax: null, modalidades: [6, 8, 4], dryRun: false });
  });

  it("le faixa de valor, UF e modalidades configuradas", () => {
    const c = loadConfig({
      TELEGRAM_BOT_TOKEN: "t",
      TELEGRAM_CHAT_ID: "c",
      RADAR_UF: "sp",
      RADAR_VALOR_MINIMO: "10000",
      RADAR_VALOR_MAXIMO: "500000",
      RADAR_MODALIDADES: "6, 8",
    });
    expect(c).toMatchObject({ uf: "SP", valorMin: 10000, valorMax: 500000, modalidades: [6, 8] });
  });

  it("exige token e chat fora do dry-run", () => {
    expect(() => loadConfig({})).toThrow(/TELEGRAM_BOT_TOKEN/);
    expect(() => loadConfig({ RADAR_DRY_RUN: "1" })).not.toThrow();
  });

  it("sem API_KEY o LLM fica desligado", () => {
    expect(loadConfig({ RADAR_DRY_RUN: "1" }).llm).toBeNull();
  });

  it("com API_KEY usa o Groq por padrao e aceita outro provedor compativel", () => {
    expect(loadConfig({ RADAR_DRY_RUN: "1", API_KEY: " k " }).llm).toEqual({
      apiKey: "k",
      baseUrl: "https://api.groq.com/openai/v1",
      model: DEFAULT_LLM_MODEL,
    });
    expect(
      loadConfig({ RADAR_DRY_RUN: "1", API_KEY: "k", LLM_BASE_URL: "https://models.github.ai/inference/", LLM_MODEL: "x" }).llm,
    ).toEqual({ apiKey: "k", baseUrl: "https://models.github.ai/inference", model: "x" });
  });

  it("rejeita valor numerico invalido", () => {
    expect(() => loadConfig({ RADAR_DRY_RUN: "1", RADAR_VALOR_MINIMO: "mil" })).toThrow(/RADAR_VALOR_MINIMO/);
  });
});
