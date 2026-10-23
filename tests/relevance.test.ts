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
