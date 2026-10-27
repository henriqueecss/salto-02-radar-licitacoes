import { describe, expect, it } from "vitest";
import { mentionsOnSite } from "../src/filter/onsite.ts";

describe("mentionsOnSite", () => {
  it.each([
    "Fábrica de software com suporte presencial no órgão",
    "Desenvolvimento de sistema com equipe alocada in loco",
    "Manutenção de sistema com técnico residente",
    "Serviços de TI com 2 postos de trabalho na sede",
    "Manutenção evolutiva, treinamento e OPERAÇÃO ASSISTIDA",
    "Atendimento PRESENCIAL aos usuários",
  ])("detecta: %s", (objeto) => {
    expect(mentionsOnSite(objeto)).toBe(true);
  });

  it.each([
    "Desenvolvimento de aplicativo móvel",
    "Fábrica de software (UST), execução remota",
    "Implantação de painéis gerenciais interativos em Power BI",
    "Manutenção do portal da transparência",
  ])("nao marca: %s", (objeto) => {
    expect(mentionsOnSite(objeto)).toBe(false);
  });
});
