import type { Edital } from "../pncp/normalize.ts";
import { isRelevant } from "./relevance.ts";

export type Criteria = {
  uf: string;
  valorMin: number;
  valorMax: number | null;
  now: Date;
};

export type Rejection = "situacao" | "uf" | "prazo" | "valor" | "relevancia";

const SITUACAO_DIVULGADA = 1;

export function rejectionReason(edital: Edital, criteria: Criteria): Rejection | null {
  if (edital.situacaoId !== SITUACAO_DIVULGADA) return "situacao";
  if (edital.uf !== criteria.uf) return "uf";
  if (edital.encerramento && edital.prazoConfiavel && edital.encerramento <= criteria.now) return "prazo";
  // valor null = sigiloso ou nao informado; nunca exclui
  if (edital.valorEstimado !== null) {
    if (edital.valorEstimado < criteria.valorMin) return "valor";
    if (criteria.valorMax !== null && edital.valorEstimado > criteria.valorMax) return "valor";
  }
  if (!isRelevant(edital.objeto)) return "relevancia";
  return null;
}
