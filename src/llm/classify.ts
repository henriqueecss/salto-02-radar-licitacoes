import { stripPlatformPrefix } from "../filter/relevance.ts";
import { defaultRetry, fetchWithRetry, HttpError, type RetryOptions } from "../http.ts";

// Qualquer provedor com a API /chat/completions no formato da OpenAI (Groq, GitHub Models, OpenRouter).
export type LlmConfig = { apiKey: string; baseUrl: string; model: string };

export type Verdict = { relevante: boolean; motivo: string };
export type LlmItem = { id: string; objeto: string };

// Varios objetos por chamada em vez de um por chamada. No plano gratuito do Groq o qwen aceita
// 1.000 tokens de saida por minuto, e cada veredito em JSON compacto custa uns 27: cabem 20
// por lote, com um lote por minuto (medido em 23/10/2026).
export const BATCH_SIZE = 20;
// Sem teto, o Groq estima a saida pelo pior caso e recusa o pedido antes de rodar.
export const MAX_OUTPUT_TOKENS = 800;

export const llmRetry: RetryOptions = {
  ...defaultRetry,
  timeoutMs: 60_000,
  maxAttempts: 4,
  baseDelayMs: 2_000,
  rateLimitDelayMs: 30_000,
  pageDelayMs: 60_000,
};

export const SYSTEM_PROMPT = `Você classifica objetos de licitações públicas para uma pequena software house de Minas Gerais que desenvolve sites, sistemas web e aplicativos.

RELEVANTE: contratos que a empresa pode executar desenvolvendo, mantendo, evoluindo ou operando software próprio: sites, portais, sistemas web, aplicativos, chatbots, lojas virtuais, painéis de dados, integrações entre sistemas, fábrica de software ou UST. Também conta a prestação de serviço de sistema ou plataforma digital quando o texto não pede licença, locação ou cessão de uso de um produto pronto, porque a empresa pode construir e operar a solução. Manutenção corretiva, adaptativa ou evolutiva de um sistema que o órgão já usa também conta, desde que o texto não contrate a licença do produto. Objeto misto conta quando desenvolver ou implantar um sistema, portal ou plataforma é parte central do contrato (por exemplo, consultoria com portal geoespacial), mas não quando o sistema é só um item acessório de um contrato de engenharia, topografia ou serviço jurídico.

NÃO RELEVANTE: compra de hardware; licenciamento, licença, cessão de uso ou locação de software pronto, mesmo com implantação, suporte ou desenvolvimento junto; operação, suporte e manutenção de infraestrutura de TIC (servidores, redes, datacenter, service desk, outsourcing de TI), mesmo que o texto cite "aplicações", a menos que peça desenvolvimento ou evolução de software; consultoria, assessoria ou adequação que não entrega software (por exemplo LGPD, governança, auditoria); impressão; internet e telefonia; CFTV; cabeamento; publicidade; cursos; e qualquer coisa fora de TI, mesmo que o texto use palavras como "sistema", "site", "portal" ou "aplicativo" (por exemplo, sistema de abastecimento de água ou publicação no site do diário oficial).

Em caso de dúvida real, marque como relevante: perder uma oportunidade custa mais caro que ler um edital irrelevante.

Você recebe uma lista JSON de objetos, cada um com um id. Responda apenas com JSON compacto, numa linha só, no formato {"itens": [{"id": "1", "relevante": true, "motivo": "até 8 palavras em português"}]}, com exatamente um item para cada id recebido.`;

export function buildRequest(objetos: string[], model: string) {
  const payload = objetos.map((objeto, i) => ({ id: String(i + 1), objeto: stripPlatformPrefix(objeto) }));
  return {
    model,
    temperature: 0,
    max_tokens: MAX_OUTPUT_TOKENS,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(payload) },
    ],
  };
}

// Devolve o veredito pela posicao no lote (0, 1, ...). Item malformado ou fora do lote fica sem veredito.
export function parseVerdicts(content: string, count: number): Map<number, Verdict> {
  const parsed = JSON.parse(content) as { itens?: unknown };
  const result = new Map<number, Verdict>();
  if (!Array.isArray(parsed.itens)) return result;
  for (const item of parsed.itens as Record<string, unknown>[]) {
    const index = Number(item?.id) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= count) continue;
    if (typeof item.relevante !== "boolean") continue;
    result.set(index, { relevante: item.relevante, motivo: typeof item.motivo === "string" ? item.motivo.trim() : "" });
  }
  return result;
}

type ChatResponse = { choices?: { message?: { content?: string } }[] };

export type ClassifyOptions = {
  config: LlmConfig;
  log: (message: string) => void;
  fetchFn?: typeof fetch;
  retry?: RetryOptions;
  batchSize?: number;
};

// Nunca lanca: o que nao for classificado fica com a decisao das regras.
export async function classifyAll(items: LlmItem[], opts: ClassifyOptions): Promise<Map<string, Verdict>> {
  const fetchFn = opts.fetchFn ?? fetch;
  const retry = opts.retry ?? llmRetry;
  const size = opts.batchSize ?? BATCH_SIZE;
  const url = `${opts.config.baseUrl}/chat/completions`;
  const result = new Map<string, Verdict>();

  for (let start = 0; start < items.length; start += size) {
    if (start > 0 && retry.pageDelayMs > 0) await retry.sleep(retry.pageDelayMs);
    const batch = items.slice(start, start + size);
    const body = JSON.stringify(buildRequest(batch.map((i) => i.objeto), opts.config.model));

    let response: ChatResponse;
    try {
      response = (await fetchWithRetry(url, fetchFn, retry, {
        method: "POST",
        headers: { authorization: `Bearer ${opts.config.apiKey}`, "content-type": "application/json" },
        body,
      })) as ChatResponse;
    } catch (error) {
      // 400: o Groq recusa o lote quando o modelo gera JSON invalido (json_validate_failed).
      if (error instanceof HttpError && error.status === 400) {
        opts.log(`LLM recusou o lote (${error.message}); ${batch.length} edital(is) ficam com as regras`);
        continue;
      }
      // Cota esgotada, chave invalida ou API fora: os proximos lotes falhariam do mesmo jeito.
      opts.log(`LLM indisponivel, ${items.length - start} edital(is) ficam com a decisao das regras: ${(error as Error).message}`);
      break;
    }

    try {
      const verdicts = parseVerdicts(response.choices?.[0]?.message?.content ?? "", batch.length);
      for (const [index, verdict] of verdicts) result.set(batch[index]!.id, verdict);
    } catch {
      opts.log(`LLM devolveu uma resposta que nao e JSON; ${batch.length} edital(is) deste lote ficam com as regras`);
    }
  }
  return result;
}
