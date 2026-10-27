import type { Edital } from "../pncp/normalize.ts";
import { stripPlatformPrefix } from "./relevance.ts";
import { normalizeText } from "./text.ts";

// O mesmo edital as vezes e publicado duas vezes no PNCP, com ids diferentes: uma com o prefixo da
// plataforma de disputa ("[Portal de Compras Publicas] -") e outra sem, em caixa diferente.
// Orgao, objeto e valor iguais depois de normalizar identificam a repeticao.
export function duplicateKey(e: Pick<Edital, "orgao" | "objeto" | "valorEstimado">): string {
  const words = (text: string) => normalizeText(text).replace(/[^a-z0-9]+/g, " ").trim();
  return `${words(e.orgao)}|${e.valorEstimado ?? 0}|${words(stripPlatformPrefix(e.objeto))}`;
}
