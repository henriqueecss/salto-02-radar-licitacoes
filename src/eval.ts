import { readFileSync } from "node:fs";

export type LabeledRow = { id: string; objeto: string; relevante: boolean };

export function loadLabeledCsv(path: string): LabeledRow[] {
  const [, ...lines] = readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.trim() !== "");
  return lines.map((line) => {
    const [id = "", objeto = "", relevante = ""] = line.split(";");
    const label = relevante.trim().toLowerCase();
    if (label !== "sim" && label !== "não" && label !== "nao") {
      throw new Error(`${id}: coluna relevante deve ser sim ou não, veio "${relevante}"`);
    }
    return { id, objeto, relevante: label === "sim" };
  });
}

export type Metrics = {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  recall: number;
  precision: number;
};

export function computeMetrics(rows: LabeledRow[], predict: (objeto: string) => boolean): Metrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  for (const row of rows) {
    const predicted = predict(row.objeto);
    if (predicted && row.relevante) tp++;
    else if (predicted) fp++;
    else if (row.relevante) fn++;
  }
  return {
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    recall: tp + fn === 0 ? 1 : tp / (tp + fn),
    precision: tp + fp === 0 ? 1 : tp / (tp + fp),
  };
}
