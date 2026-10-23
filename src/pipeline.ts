import type { Config } from "./config.ts";
import { rejectionReason, type Rejection } from "./filter/criteria.ts";
import { hasItVocabulary, isRelevant, scoreRelevance } from "./filter/relevance.ts";
import type { LlmItem, Verdict } from "./llm/classify.ts";
import type { FetchOptions } from "./pncp/client.ts";
import { normalizeContratacao, type Edital, type PncpContratacao } from "./pncp/normalize.ts";
import type { Scored, Store } from "./store/db.ts";
import { buildMessages } from "./telegram/format.ts";

export type RadarDeps = {
  config: Pick<Config, "uf" | "valorMin" | "valorMax" | "modalidades">;
  now: Date;
  fetchContratacoes: (opts: Pick<FetchOptions, "uf" | "modalidades" | "dataFinal">) => Promise<PncpContratacao[]>;
  send: (messages: string[]) => Promise<void>;
  store: Store;
  log: (message: string) => void;
  dryRun?: boolean;
  // Sem LLM, a relevancia e decidida so pelas regras.
  llm?: { model: string; classify: (items: LlmItem[]) => Promise<Map<string, Verdict>>; maxPerRun?: number };
};

// Com um lote de 20 por minuto, 200 editais cabem em uns 10 minutos, dentro do timeout do job.
// So o primeiro dia passa disso; o resto fica para as execucoes seguintes.
export const MAX_LLM_PER_RUN = 200;

export type RadarResult = { coletados: number; novos: number };

// Data final da consulta /proposta: um ano a frente cobre qualquer prazo de proposta aberto.
function dataFinal(now: Date): string {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

// O LLM julga o que as regras aprovaram e o que elas rejeitaram mas tem vocabulario de TI.
// Cada edital e julgado uma vez so: o veredito fica guardado e vale nas execucoes seguintes.
async function judge(editais: Edital[], deps: RadarDeps): Promise<Map<string, Verdict>> {
  if (!deps.llm) return new Map();
  const candidates = editais.filter((e) => isRelevant(e.objeto) || hasItVocabulary(e.objeto));
  const verdicts = deps.store.getVerdicts(candidates.map((e) => e.id));
  // Aprovados pelas regras primeiro: sao eles que iriam para o Telegram sem o veredito.
  const pending = candidates
    .filter((e) => !verdicts.has(e.id))
    .sort((a, b) => Number(isRelevant(b.objeto)) - Number(isRelevant(a.objeto)))
    .slice(0, deps.llm.maxPerRun ?? MAX_LLM_PER_RUN);

  let fresh = new Map<string, Verdict>();
  if (pending.length > 0) {
    try {
      fresh = await deps.llm.classify(pending.map((e) => ({ id: e.id, objeto: e.objeto })));
    } catch (error) {
      deps.log(`erro no LLM, vale a decisao das regras: ${(error as Error).message}`);
    }
    if (!deps.dryRun) deps.store.saveVerdicts(fresh, deps.llm.model, deps.now);
  }

  deps.log(
    `llm candidatos=${candidates.length} em_cache=${verdicts.size} classificados_agora=${fresh.size} ` +
      `sem_veredito=${candidates.length - verdicts.size - fresh.size}`,
  );
  return new Map([...verdicts, ...fresh]);
}

export async function runRadar(deps: RadarDeps): Promise<RadarResult> {
  const { config, now, log } = deps;

  const raw = await deps.fetchContratacoes({ uf: config.uf, modalidades: config.modalidades, dataFinal: dataFinal(now) });
  const editais = raw.map(normalizeContratacao);

  // Criterios objetivos primeiro; a relevancia do objeto e decidida depois, so para o que ainda nao foi enviado.
  const rejected: Partial<Record<Rejection, number>> = {};
  const eligible = editais.filter((e) => {
    const reason = rejectionReason(e, { ...config, now });
    if (reason && reason !== "relevancia") rejected[reason] = (rejected[reason] ?? 0) + 1;
    return reason === null || reason === "relevancia";
  });
  const unseen = deps.store.filterUnseen(eligible);
  const verdicts = await judge(unseen, deps);

  const fresh: Scored[] = [];
  for (const edital of unseen) {
    const verdict = verdicts.get(edital.id);
    if (!(verdict?.relevante ?? isRelevant(edital.objeto))) {
      rejected.relevancia = (rejected.relevancia ?? 0) + 1;
      continue;
    }
    fresh.push({ edital, score: scoreRelevance(edital.objeto).score, motivo: verdict?.motivo });
  }

  log(
    `coletados=${editais.length} elegiveis=${eligible.length} nao_enviados=${unseen.length} novos=${fresh.length} ` +
      `rejeitados=${JSON.stringify(rejected)}`,
  );

  await deps.send(buildMessages(fresh, now));
  // So grava depois do envio: se o Telegram falhar, os editais voltam na proxima execucao.
  if (!deps.dryRun) deps.store.markSent(fresh, now);

  return { coletados: editais.length, novos: fresh.length };
}
