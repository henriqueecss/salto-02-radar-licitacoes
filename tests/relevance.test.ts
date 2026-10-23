import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeMetrics, loadLabeledCsv } from "../src/eval.ts";
import { isRelevant, scoreRelevance } from "../src/filter/relevance.ts";

const rows = loadLabeledCsv("data/objetos_rotulados.csv");
const byId = (id: string) => {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`id ${id} nao encontrado`);
  return row.objeto;
};

describe("conjunto rotulado", () => {
  it("tem 40 exemplos, 15 relevantes", () => {
    expect(rows).toHaveLength(40);
    expect(rows.filter((r) => r.relevante)).toHaveLength(15);
  });

  it("atinge recall de 100% e precisao de pelo menos 85%", () => {
    const m = computeMetrics(rows, isRelevant);
    expect(m.recall).toBe(1);
    expect(m.precision).toBeGreaterThanOrEqual(0.85);
  });

  it.each(rows.filter((r) => r.relevante).map((r) => [r.id, r.objeto]))(
    "%s relevante nao pode ser perdido",
    (_id, objeto) => {
      expect(isRelevant(objeto)).toBe(true);
    },
  );
});

describe("armadilhas", () => {
  it.each([
    ["I01", "sistema de abastecimento de agua"],
    ["I03", "locacao de software pronto"],
    ["I04", "licenca de software"],
    ["I06", "sistema de CFTV"],
    ["I10", "manutencao do sistema de iluminacao"],
    ["I12", "site do diario oficial"],
    ["I13", "portais de noticias"],
    ["I15", "pneus para a frota"],
    ["I18", "desenvolvimento de projeto de engenharia"],
    ["I19", "manutencao corretiva de computadores"],
    ["I20", "tablet com aplicativo pre-instalado"],
  ])("%s nao e relevante (%s)", (id) => {
    expect(isRelevant(byId(id))).toBe(false);
  });

  it.each([
    ["R04", "orgao de agua e esgoto, objeto e site"],
    ["R08", "sitio eletronico"],
    ["R14", "frota com aplicativo"],
    ["R15", "manutencao de codigo proprio"],
  ])("%s e relevante (%s)", (id) => {
    expect(isRelevant(byId(id))).toBe(true);
  });
});

describe("armadilhas vistas no PNCP real (23/10/2026)", () => {
  it.each([
    ["licenciamento de uso", "Licenciamento de uso de sistema de gestão pública com manutenção evolutiva e corretiva"],
    ["licenciamento com desenvolvimento junto", "Licenciamento de software de gestão em ambiente web, incluindo desenvolvimento sob demanda"],
    ["SaaS", "Contratação de sistema web de protocolo na modalidade Software como Serviço (SaaS)"],
    ["cessao de direito de uso", "Cessão de direito de uso de sistema informatizado de gestão escolar"],
    ["fornecimento de sistema pronto", "Fornecimento de sistema de gestão hospitalar integrado para os municípios consorciados"],
    ["fornecimento de solucao", "Fornecimento de solução integrada de ponto eletrônico com relógio e aplicativo"],
    ["frota com cartao", "Gerenciamento de frota por meio de sistema informatizado com cartão magnético"],
    ["abastecimento de combustivel", "Sistema informatizado de abastecimento de combustíveis da frota municipal"],
    ["prefixo de plataforma de compras", "[Portal de Compras Públicas] - Manutenção do sistema de drenagem pluvial"],
  ])("%s nao e relevante", (_caso, objeto) => {
    expect(isRelevant(objeto)).toBe(false);
  });

  it.each([
    ["prefixo nao atrapalha edital bom", "[LICITANET] - Desenvolvimento de portal institucional"],
    ["sitio eletronico com hospedagem", "Prestação de serviços de sítio eletrônico e hospedagem"],
  ])("%s", (_caso, objeto) => {
    expect(isRelevant(objeto)).toBe(true);
  });
});

describe("scoreRelevance", () => {
  it("explica quais termos pesaram", () => {
    const r = scoreRelevance("Contratação de fábrica de software");
    expect(r.hits).toContain("fabrica de software");
    expect(r.score).toBeGreaterThan(0);
  });

  it("termo de exclusao reduz a pontuacao", () => {
    const base = scoreRelevance("desenvolvimento de sistema web").score;
    const comExclusao = scoreRelevance("locacao de sistema web").score;
    expect(comExclusao).toBeLessThan(base);
  });

  it("ignora acentos e caixa", () => {
    expect(scoreRelevance("SÍTIO ELETRÔNICO").score).toBe(scoreRelevance("sitio eletronico").score);
  });
});

describe("loadLabeledCsv", () => {
  it("recusa linha sem rotulo em vez de contar como nao relevante", () => {
    const dir = mkdtempSync(join(tmpdir(), "radar-"));
    const path = join(dir, "amostra.csv");
    writeFileSync(path, "id;objeto;relevante;link\nA1;Sistema web;sim;x\nA2;Pneus;;x\n");
    expect(() => loadLabeledCsv(path)).toThrow(/A2/);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("computeMetrics", () => {
  it("calcula recall e precisao", () => {
    const sample = [
      { id: "a", objeto: "x", relevante: true },
      { id: "b", objeto: "y", relevante: true },
      { id: "c", objeto: "x", relevante: false },
    ];
    const m = computeMetrics(sample, (o) => o === "x");
    expect(m).toMatchObject({ truePositives: 1, falsePositives: 1, falseNegatives: 1, recall: 0.5, precision: 0.5 });
  });
});
