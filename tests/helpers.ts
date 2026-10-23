import { readFileSync } from "node:fs";
import type { PncpContratacao, PncpPage } from "../src/pncp/normalize.ts";

export function loadFixture(name: string): PncpPage {
  return JSON.parse(readFileSync(`tests/fixtures/${name}`, "utf8"));
}

export function rawContratacao(overrides: Partial<PncpContratacao> = {}): PncpContratacao {
  return {
    numeroControlePNCP: "18338152000164-1-000055/2026",
    objetoCompra: "Desenvolvimento de sistema web para a prefeitura",
    valorTotalEstimado: 100000,
    modalidadeId: 6,
    modalidadeNome: "Pregão - Eletrônico",
    dataAberturaProposta: "2026-10-20T09:00:00",
    dataEncerramentoProposta: "2026-11-03T09:00:00",
    situacaoCompraId: 1,
    situacaoCompraNome: "Divulgada no PNCP",
    orgaoEntidade: { cnpj: "18338152000164", razaoSocial: "MUNICIPIO DE CORONEL PACHECO" },
    unidadeOrgao: { municipioNome: "Coronel Pacheco", ufSigla: "MG", codigoIbge: "3119609" },
    linkSistemaOrigem: null,
    ...overrides,
  };
}
