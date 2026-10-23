import { describe, expect, it } from "vitest";
import { cleanText, normalizeText } from "../src/filter/text.ts";

describe("cleanText", () => {
  it("remove espacos nas pontas e junta quebras de linha e tabs", () => {
    expect(cleanText("  REGISTRO DE PREÇOS\nPARA\t\tCOMPRA  ")).toBe("REGISTRO DE PREÇOS PARA COMPRA");
  });

  it("preserva acentos e caixa para exibicao", () => {
    expect(cleanText("Aquisição de Pneus")).toBe("Aquisição de Pneus");
  });
});

describe("normalizeText", () => {
  it("passa para minusculas e remove acentos", () => {
    expect(normalizeText("CONTRATAÇÃO DE SÍTIO ELETRÔNICO")).toBe("contratacao de sitio eletronico");
  });

  it("trata texto sujo do PNCP", () => {
    expect(normalizeText(" O OBJETO DA LICITAÇÃO\n\té a\r\nAQUISIÇÃO ")).toBe("o objeto da licitacao e a aquisicao");
  });

  it("aceita texto vazio", () => {
    expect(normalizeText("   ")).toBe("");
  });
});
