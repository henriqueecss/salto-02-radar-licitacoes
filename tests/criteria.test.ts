import { describe, expect, it } from "vitest";
import { rejectionReason, type Criteria } from "../src/filter/criteria.ts";
import { normalizeContratacao } from "../src/pncp/normalize.ts";
import { rawContratacao } from "./helpers.ts";

const criteria: Criteria = {
  uf: "MG",
  valorMin: 50000,
  valorMax: 500000,
  now: new Date("2026-10-23T11:00:00Z"),
};

const edital = (o: Parameters<typeof rawContratacao>[0] = {}) => normalizeContratacao(rawContratacao(o));

describe("rejectionReason", () => {
  it("aceita edital dentro de todos os criterios", () => {
    expect(rejectionReason(edital(), criteria)).toBeNull();
  });

  it("rejeita situacao diferente de Divulgada no PNCP", () => {
    expect(rejectionReason(edital({ situacaoCompraId: 4 }), criteria)).toBe("situacao");
  });

  it("rejeita outra UF", () => {
    const e = edital({ unidadeOrgao: { municipioNome: "Vitoria", ufSigla: "ES", codigoIbge: "3205309" } });
    expect(rejectionReason(e, criteria)).toBe("uf");
  });

  it("UF e configuravel", () => {
    const e = edital({ unidadeOrgao: { municipioNome: "Vitoria", ufSigla: "ES", codigoIbge: "3205309" } });
    expect(rejectionReason(e, { ...criteria, uf: "ES" })).toBeNull();
  });

  it("rejeita prazo encerrado", () => {
    expect(rejectionReason(edital({ dataEncerramentoProposta: "2026-10-23T07:59:00" }), criteria)).toBe("prazo");
  });

  it("aceita prazo que encerra mais tarde no mesmo dia", () => {
    expect(rejectionReason(edital({ dataEncerramentoProposta: "2026-10-23T14:00:00" }), criteria)).toBeNull();
  });

  it("nao exclui por prazo ausente", () => {
    expect(rejectionReason(edital({ dataEncerramentoProposta: null }), criteria)).toBeNull();
  });

  it("nao exclui por prazo de preenchimento (31/12)", () => {
    const e = edital({ dataAberturaProposta: "2026-12-31T08:00:00", dataEncerramentoProposta: "2026-12-31T09:00:00" });
    expect(rejectionReason(e, { ...criteria, now: new Date("2027-01-02T12:00:00Z") })).toBeNull();
  });

  it("rejeita valor abaixo do minimo e acima do maximo", () => {
    expect(rejectionReason(edital({ valorTotalEstimado: 1000 }), criteria)).toBe("valor");
    expect(rejectionReason(edital({ valorTotalEstimado: 900000 }), criteria)).toBe("valor");
  });

  it("valor zero ou ausente nunca exclui", () => {
    expect(rejectionReason(edital({ valorTotalEstimado: 0 }), criteria)).toBeNull();
    expect(rejectionReason(edital({ valorTotalEstimado: null }), criteria)).toBeNull();
  });

  it("sem maximo configurado aceita qualquer valor acima do minimo", () => {
    expect(rejectionReason(edital({ valorTotalEstimado: 9e9 }), { ...criteria, valorMax: null })).toBeNull();
  });

  it("rejeita objeto fora do perfil", () => {
    expect(rejectionReason(edital({ objetoCompra: "AQUISIÇÃO DE PNEUS PARA A FROTA" }), criteria)).toBe("relevancia");
  });
});
