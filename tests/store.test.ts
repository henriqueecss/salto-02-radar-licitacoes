import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeContratacao } from "../src/pncp/normalize.ts";
import { openStore } from "../src/store/db.ts";
import { rawContratacao } from "./helpers.ts";

const objeto = (seq: number) => `Desenvolvimento de sistema web para a prefeitura, lote ${seq}`;

const edital = (seq: number) =>
  normalizeContratacao(
    rawContratacao({ numeroControlePNCP: `18338152000164-1-${String(seq).padStart(6, "0")}/2026`, objetoCompra: objeto(seq) }),
  );

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("store", () => {
  it("devolve tudo como novo num banco vazio", () => {
    const store = openStore(":memory:");
    expect(store.filterUnseen([edital(1), edital(2)]).map((e) => e.id)).toHaveLength(2);
    store.close();
  });

  it("nao devolve de novo o que ja foi enviado", () => {
    const store = openStore(":memory:");
    store.markSent([{ edital: edital(1), score: 6 }], new Date("2026-10-23T11:00:00Z"));
    expect(store.filterUnseen([edital(1), edital(2)]).map((e) => e.id)).toEqual([edital(2).id]);
    store.close();
  });

  it("deduplica entre execucoes (arquivo reaberto)", () => {
    const dir = mkdtempSync(join(tmpdir(), "radar-"));
    dirs.push(dir);
    const path = join(dir, "radar.db");

    const first = openStore(path);
    first.markSent([{ edital: edital(1), score: 6 }], new Date("2026-10-22T11:00:00Z"));
    first.close();

    const second = openStore(path);
    expect(second.filterUnseen([edital(1), edital(2)]).map((e) => e.id)).toEqual([edital(2).id]);
    expect(second.count()).toBe(1);
    second.close();
  });

  it("marcar duas vezes o mesmo edital nao duplica nem quebra", () => {
    const store = openStore(":memory:");
    const now = new Date("2026-10-23T11:00:00Z");
    store.markSent([{ edital: edital(1), score: 6 }], now);
    store.markSent([{ edital: edital(1), score: 6 }], now);
    expect(store.count()).toBe(1);
    store.close();
  });

  it("guarda a classificacao do LLM e devolve so a dos ids pedidos", () => {
    const store = openStore(":memory:");
    store.saveVerdicts(
      new Map([
        ["a", { relevante: true, motivo: "site" }],
        ["b", { relevante: false, motivo: "pneu" }],
      ]),
      "modelo-x",
      new Date("2026-10-23T11:00:00Z"),
    );
    const cached = store.getVerdicts(["b", "c"]);
    expect([...cached.entries()]).toEqual([["b", { relevante: false, motivo: "pneu" }]]);
    store.close();
  });

  it("classificacao sobrevive entre execucoes e pode ser sobrescrita", () => {
    const dir = mkdtempSync(join(tmpdir(), "radar-"));
    dirs.push(dir);
    const path = join(dir, "radar.db");
    const at = new Date("2026-10-23T11:00:00Z");

    const first = openStore(path);
    first.saveVerdicts(new Map([["a", { relevante: false, motivo: "v1" }]]), "m", at);
    first.close();

    const second = openStore(path);
    second.saveVerdicts(new Map([["a", { relevante: true, motivo: "v2" }]]), "m", at);
    expect(second.getVerdicts(["a"]).get("a")).toEqual({ relevante: true, motivo: "v2" });
    second.close();
  });

  it("deduplica repeticoes dentro da mesma coleta", () => {
    const store = openStore(":memory:");
    expect(store.filterUnseen([edital(1), edital(1)])).toHaveLength(1);
    store.close();
  });

  describe("mesmo edital republicado com outro id", () => {
    const original = edital(1);
    const republished = normalizeContratacao(
      rawContratacao({
        numeroControlePNCP: "18338152000164-1-000002/2026",
        objetoCompra: `[Portal de Compras Públicas] - ${objeto(1).toUpperCase()}`,
      }),
    );

    it("fica so um na mesma coleta", () => {
      const store = openStore(":memory:");
      expect(store.filterUnseen([original, republished]).map((e) => e.id)).toEqual([original.id]);
      store.close();
    });

    it("nao e reenviado depois que o primeiro foi enviado", () => {
      const store = openStore(":memory:");
      store.markSent([{ edital: original, score: 6 }], new Date("2026-10-23T11:00:00Z"));
      expect(store.filterUnseen([republished])).toHaveLength(0);
      store.close();
    });

    it("em banco criado antes da chave, reconhece os editais ja enviados", () => {
      const dir = mkdtempSync(join(tmpdir(), "radar-"));
      dirs.push(dir);
      const path = join(dir, "radar.db");

      const legacy = new DatabaseSync(path);
      legacy.exec(`
        CREATE TABLE editais (
          id TEXT PRIMARY KEY, objeto TEXT NOT NULL, orgao TEXT NOT NULL, municipio TEXT NOT NULL,
          uf TEXT NOT NULL, modalidade TEXT NOT NULL, valor_estimado REAL, encerramento TEXT,
          link TEXT NOT NULL, score INTEGER NOT NULL, sent_at TEXT NOT NULL
        );
      `);
      legacy
        .prepare("INSERT INTO editais VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(original.id, original.objeto, original.orgao, original.municipio, original.uf, original.modalidade, original.valorEstimado, null, original.link, 6, "2026-10-22T11:00:00Z");
      legacy.close();

      const store = openStore(path);
      expect(store.filterUnseen([republished])).toHaveLength(0);
      expect(store.count()).toBe(1);
      store.close();
    });
  });
});
