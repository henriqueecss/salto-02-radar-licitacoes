import type { Config } from "./config.ts";
import { rejectionReason, type Rejection } from "./filter/criteria.ts";
import { scoreRelevance } from "./filter/relevance.ts";
import type { FetchOptions } from "./pncp/client.ts";
import { normalizeContratacao, type PncpContratacao } from "./pncp/normalize.ts";
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
};

export type RadarResult = { coletados: number; aprovados: number; novos: number };

// Data final da consulta /proposta: um ano a frente cobre qualquer prazo de proposta aberto.
function dataFinal(now: Date): string {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export async function runRadar(deps: RadarDeps): Promise<RadarResult> {
  const { config, now, log } = deps;

  const raw = await deps.fetchContratacoes({ uf: config.uf, modalidades: config.modalidades, dataFinal: dataFinal(now) });
  const editais = raw.map(normalizeContratacao);

  const rejected: Partial<Record<Rejection, number>> = {};
  const approved = editais.filter((e) => {
    const reason = rejectionReason(e, { ...config, now });
    if (reason) rejected[reason] = (rejected[reason] ?? 0) + 1;
    return reason === null;
  });

  const fresh: Scored[] = deps.store
    .filterUnseen(approved)
    .map((edital) => ({ edital, score: scoreRelevance(edital.objeto).score }));

  log(
    `coletados=${editais.length} aprovados=${approved.length} novos=${fresh.length} ` +
      `rejeitados=${JSON.stringify(rejected)}`,
  );

  await deps.send(buildMessages(fresh, now));
  // So grava depois do envio: se o Telegram falhar, os editais voltam na proxima execucao.
  if (!deps.dryRun) deps.store.markSent(fresh, now);

  return { coletados: editais.length, aprovados: approved.length, novos: fresh.length };
}
