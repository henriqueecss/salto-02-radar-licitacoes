import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
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
  )
`;

export type Scored = { edital: Edital; score: number };

export type Store = {
  filterUnseen(editais: Edital[]): Edital[];
  markSent(items: Scored[], sentAt: Date): void;
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
      db.exec("BEGIN");
      try {
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
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    count() {
      return Number((db.prepare("SELECT COUNT(*) AS n FROM editais").get() as { n: number }).n);
    },
    close() {
      db.close();
    },
  };
}
