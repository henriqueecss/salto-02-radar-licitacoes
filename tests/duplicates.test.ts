import { describe, expect, it } from "vitest";
import { duplicateKey } from "../src/filter/duplicates.ts";
import { normalizeContratacao } from "../src/pncp/normalize.ts";
import { rawContratacao } from "./helpers.ts";

const key = (overrides: Parameters<typeof rawContratacao>[0]) => duplicateKey(normalizeContratacao(rawContratacao(overrides)));

describe("duplicateKey", () => {
  it("ignora prefixo da plataforma, caixa, acento e pontuacao", () => {
    const original = key({ objetoCompra: "Serviços técnicos do sistema e-Cidade, compatível com PHP." });
    const republished = key({ objetoCompra: "[Portal de Compras Públicas] - SERVIÇOS TÉCNICOS DO SISTEMA E-CIDADE, COMPATÍVEL COM PHP" });
    expect(republished).toBe(original);
  });

  it("separa orgaos diferentes com o mesmo objeto", () => {
    const a = key({ objetoCompra: "Desenvolvimento de site" });
    const b = key({
      objetoCompra: "Desenvolvimento de site",
      orgaoEntidade: { cnpj: "00000000000191", razaoSocial: "MUNICIPIO DE OUTRA CIDADE" },
    });
    expect(b).not.toBe(a);
  });

  it("separa valores diferentes com o mesmo objeto e orgao", () => {
    expect(key({ valorTotalEstimado: 1000 })).not.toBe(key({ valorTotalEstimado: 2000 }));
  });

  it("trata valor zero e ausente como o mesmo valor", () => {
    expect(key({ valorTotalEstimado: 0 })).toBe(key({ valorTotalEstimado: null }));
  });
});
