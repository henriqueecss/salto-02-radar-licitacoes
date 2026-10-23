import { computeMetrics, loadLabeledCsv } from "../src/eval.ts";
import { isRelevant, scoreRelevance } from "../src/filter/relevance.ts";

const path = process.argv[2] ?? "data/objetos_rotulados.csv";
const rows = loadLabeledCsv(path);

for (const row of rows) {
  const { score, hits } = scoreRelevance(row.objeto);
  const predicted = isRelevant(row.objeto);
  const mark = predicted === row.relevante ? "ok  " : "ERRO";
  console.log(`${mark} ${row.id} score=${score} [${hits.join(", ")}]`);
}

const m = computeMetrics(rows, isRelevant);
console.log(
  `\n${path}: recall ${(m.recall * 100).toFixed(1)}% | precisao ${(m.precision * 100).toFixed(1)}% ` +
    `(VP=${m.truePositives} FP=${m.falsePositives} FN=${m.falseNegatives})`,
);
