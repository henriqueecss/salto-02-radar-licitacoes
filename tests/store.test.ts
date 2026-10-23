import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeContratacao } from "../src/pncp/normalize.ts";
import { openStore } from "../src/store/db.ts";
import { rawContratacao } from "./helpers.ts";

const edital = (seq: number) =>
  normalizeContratacao(rawContratacao({ numeroControlePNCP: `18338152000164-1-${String(seq).padStart(6, "0")}/2026` }));

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
});
