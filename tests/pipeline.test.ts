import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.ts";
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

    expect(result).toMatchObject({ coletados: collected.length, aprovados: 2, novos: 2 });
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

  it("em modo dry-run imprime em vez de gravar", async () => {
    const d = deps({ dryRun: true });
    await runRadar(d);
    expect(d.send).toHaveBeenCalled();
    expect(d.store.count()).toBe(0);
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

  it("rejeita valor numerico invalido", () => {
    expect(() => loadConfig({ RADAR_DRY_RUN: "1", RADAR_VALOR_MINIMO: "mil" })).toThrow(/RADAR_VALOR_MINIMO/);
  });
});
