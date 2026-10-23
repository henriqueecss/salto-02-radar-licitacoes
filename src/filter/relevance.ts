import { normalizeText } from "./text.ts";

type Rule = { label: string; pattern: RegExp; weight: number };

// Pesos sobre texto normalizado (sem acento, minusculo).
// Termo forte (+3) sozinho ja aprova; termo fraco (+1) so aprova somado a outros;
// termo de exclusao (-3) indica compra fora do perfil e anula um termo forte.
const STRONG = 3;
const WEAK = 1;
const EXCLUDE = -3;

export const THRESHOLD = 3;

const rules: Rule[] = [
  ...[
    "fabrica de software",
    "desenvolvimento de software",
    "desenvolvimento de sistemas?",
    "desenvolvimento de aplicativos?",
    "sistemas? web",
    "sistemas? (informatizados?|de gestao|de informacao)",
    "aplicativos? (movel|moveis|mobile)",
    "website",
    "sitio eletronico",
    "portal (institucional|da transparencia|do cidadao)",
    "plataforma digital",
    "chatbot",
    "loja virtual",
    "e-commerce",
    "dashboard",
    "painel de indicadores",
    "unidades? de servico tecnico",
    "ust",
    "api",
    "codigo-fonte",
    "manutencao (evolutiva|adaptativa)",
    "sustentacao de sistemas?",
  ].map((t) => ({ label: t, pattern: new RegExp(`\\b${t}\\b`), weight: STRONG })),
  ...[
    "desenvolvimento",
    "criacao",
    "manutencao",
    "migracao",
    "integracao",
    "sistemas?",
    "softwares?",
    "aplicativos?",
    "portal",
    "sites?",
    "tecnologia da informacao",
  ].map((t) => ({ label: t, pattern: new RegExp(`\\b${t}\\b`), weight: WEAK })),
  ...[
    "aquisicao",
    "locacao",
    "licencas?",
    "cftv",
    "videomonitoramento",
    "impressao",
    "impressoras?",
    "internet",
    "fibra optica",
    "telefonia",
    "pneus",
    "publicidade",
    "publicacao de atos",
    "jornal",
    "cursos?",
    "capacitacao",
    "cabeamento",
    "rede logica",
    "computadores",
    "notebooks?",
    "tablets?",
    "engenharia",
    "pavimentacao",
    "abastecimento de agua",
    "energia solar",
    "iluminacao",
    "sonorizacao",
    "radiografia",
    "e-mails?",
  ].map((t) => ({ label: t, pattern: new RegExp(`\\b${t}\\b`), weight: EXCLUDE })),
];

export type RelevanceResult = { score: number; hits: string[] };

export function scoreRelevance(objeto: string): RelevanceResult {
  const text = normalizeText(objeto);
  let score = 0;
  const hits: string[] = [];
  for (const rule of rules) {
    if (rule.pattern.test(text)) {
      score += rule.weight;
      hits.push(rule.label);
    }
  }
  return { score, hits };
}

export function isRelevant(objeto: string): boolean {
  return scoreRelevance(objeto).score >= THRESHOLD;
}
