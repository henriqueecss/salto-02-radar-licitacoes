import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Verdict } from "../llm/classify.ts";
import type { Edital } from "../pncp/normalize.ts";

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS editais (
    id TEXT PRIMARY KEY,
    objeto TEXT NOT NULL,
    orgao TEXT NOT NULL,
    municipio TEXT NOT NULL,
    uf TEXT NOT NULL,
    modalidade TEXT NOT NULL,
    valor_estimado REAL,
    encerramento TEXT,
    link TEXT NOT NULL,
    score INTEGER NOT NULL,
    sent_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS classificacoes (
    id TEXT PRIMARY KEY,
    relevante INTEGER NOT NULL,
    motivo TEXT NOT NULL,
    modelo TEXT NOT NULL,
    classified_at TEXT NOT NULL
  );
`;

export type Scored = { edital: Edital; score: number; motivo?: string };

export type Store = {
  filterUnseen(editais: Edital[]): Edital[];
  markSent(items: Scored[], sentAt: Date): void;
  getVerdicts(ids: string[]): Map<string, Verdict>;
  saveVerdicts(verdicts: Map<string, Verdict>, model: string, at: Date): void;
  count(): number;
  close(): void;
};

export function openStore(path: string): Store {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);

  const exists = db.prepare("SELECT 1 FROM editais WHERE id = ?");
  const insert = db.prepare(`
    INSERT OR IGNORE INTO editais
      (id, objeto, orgao, municipio, uf, modalidade, valor_estimado, encerramento, link, score, sent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const selectVerdict = db.prepare("SELECT relevante, motivo FROM classificacoes WHERE id = ?");
  const upsertVerdict = db.prepare(`
    INSERT OR REPLACE INTO classificacoes (id, relevante, motivo, modelo, classified_at) VALUES (?, ?, ?, ?, ?)
  `);

  const transaction = (fn: () => void) => {
    db.exec("BEGIN");
    try {
      fn();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  return {
    filterUnseen(editais) {
      const seen = new Set<string>();
      return editais.filter((e) => {
        if (seen.has(e.id) || exists.get(e.id)) return false;
        seen.add(e.id);
        return true;
      });
    },
    markSent(items, sentAt) {
      transaction(() => {
        for (const { edital: e, score } of items) {
          insert.run(
            e.id,
            e.objeto,
            e.orgao,
            e.municipio,
            e.uf,
            e.modalidade,
            e.valorEstimado,
            e.encerramento?.toISOString() ?? null,
            e.link,
            score,
            sentAt.toISOString(),
          );
        }
      });
    },
    getVerdicts(ids) {
      const result = new Map<string, Verdict>();
      for (const id of ids) {
        const row = selectVerdict.get(id) as { relevante: number; motivo: string } | undefined;
        if (row) result.set(id, { relevante: row.relevante === 1, motivo: row.motivo });
      }
      return result;
    },
    saveVerdicts(verdicts, model, at) {
      transaction(() => {
        for (const [id, v] of verdicts) upsertVerdict.run(id, v.relevante ? 1 : 0, v.motivo, model, at.toISOString());
      });
    },
    count() {
      return Number((db.prepare("SELECT COUNT(*) AS n FROM editais").get() as { n: number }).n);
    },
    close() {
      db.close();
    },
  };
}
