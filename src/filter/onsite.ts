import { normalizeText } from "./text.ts";

// A empresa trabalha a distancia. So rotula, nao exclui: a exigencia de comparecimento costuma estar
// no termo de referencia, que o radar nao le, e o objeto so a entrega quando o orgao a destaca.
const ON_SITE = /\b(presencial|presenciais|in loco|postos? de trabalho|tecnico residente|operacao assistida)\b/;

export function mentionsOnSite(objeto: string): boolean {
  return ON_SITE.test(normalizeText(objeto));
}
