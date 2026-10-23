import { describe, expect, it } from "vitest";
import { normalizeContratacao, parseBrasiliaDate, pncpUrl } from "../src/pncp/normalize.ts";
import { loadFixture, rawContratacao } from "./helpers.ts";

describe("parseBrasiliaDate", () => {
  it("le data sem fuso como horario de Brasilia (UTC-3)", () => {
    expect(parseBrasiliaDate("2026-11-03T09:00:00")?.toISOString()).toBe("2026-11-03T12:00:00.000Z");
  });

  it("devolve null para ausente ou invalido", () => {
    expect(parseBrasiliaDate(null)).toBeNull();
    expect(parseBrasiliaDate("lixo")).toBeNull();
  });
});

describe("pncpUrl", () => {
  it("monta o link da pagina do edital a partir do numeroControlePNCP", () => {
    expect(pncpUrl("18278051000145-1-000133/2026")).toBe("https://pncp.gov.br/app/editais/18278051000145/2026/133");
  });
});

describe("normalizeContratacao", () => {
  it("limpa o objeto e extrai os campos usados", () => {
    const e = normalizeContratacao(rawContratacao({ objetoCompra: "  SISTEMA\nWEB  " }));
    expect(e).toMatchObject({
      id: "18338152000164-1-000055/2026",
      objeto: "SISTEMA WEB",
      orgao: "MUNICIPIO DE CORONEL PACHECO",
      municipio: "Coronel Pacheco",
      uf: "MG",
      valorEstimado: 100000,
      situacaoId: 1,
      modalidade: "Pregão - Eletrônico",
      prazoConfiavel: true,
      link: "https://pncp.gov.br/app/editais/18338152000164/2026/55",
    });
  });

  it("valor zero ou ausente vira null (orcamento sigiloso)", () => {
    expect(normalizeContratacao(rawContratacao({ valorTotalEstimado: 0 })).valorEstimado).toBeNull();
    expect(normalizeContratacao(rawContratacao({ valorTotalEstimado: null })).valorEstimado).toBeNull();
  });

  it("marca como nao confiavel o prazo de preenchimento em 31/12 com abertura no mesmo dia", () => {
    const e = normalizeContratacao(
      rawContratacao({ dataAberturaProposta: "2026-12-31T08:00:00", dataEncerramentoProposta: "2026-12-31T09:00:00" }),
    );
    expect(e.prazoConfiavel).toBe(false);
  });

  it("mantem o link do sistema de origem quando existe", () => {
    const e = normalizeContratacao(rawContratacao({ linkSistemaOrigem: "https://compras.exemplo.mg.gov.br/123" }));
    expect(e.linkOrigem).toBe("https://compras.exemplo.mg.gov.br/123");
  });

  it("normaliza todos os registros reais gravados sem quebrar", () => {
    const page = loadFixture("proposta-mg-mod6-p1.json");
    const editais = page.data.map(normalizeContratacao);
    expect(editais).toHaveLength(10);
    for (const e of editais) {
      expect(e.objeto).toBe(e.objeto.trim());
      expect(e.objeto).not.toMatch(/\n/);
      expect(e.link).toMatch(/^https:\/\/pncp\.gov\.br\/app\/editais\/\d{14}\/\d{4}\/\d+$/);
    }
    expect(editais[0]?.prazoConfiavel).toBe(false);
  });
});
