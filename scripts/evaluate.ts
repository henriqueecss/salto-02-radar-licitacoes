import { existsSync } from "node:fs";
import { loadConfig } from "../src/config.ts";
import { computeMetrics, loadLabeledCsv } from "../src/eval.ts";
import { hasItVocabulary, isRelevant, scoreRelevance } from "../src/filter/relevance.ts";
import { BATCH_SIZE, classifyAll } from "../src/llm/classify.ts";

// npm run evaluate -- [arquivo.csv] [--llm] [--batch=N]
const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith("--")) ?? "data/objetos_rotulados.csv";
const useLlm = args.includes("--llm");
const batchSize = Number(args.find((a) => a.startsWith("--batch="))?.split("=")[1]) || BATCH_SIZE;
const rows = loadLabeledCsv(path);

let predict = isRelevant;
let motivos = new Map<string, string>();

if (useLlm) {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const llm = loadConfig({ ...process.env, RADAR_DRY_RUN: "1" }).llm;
  if (!llm) throw new Error("Defina API_KEY no .env para avaliar com o LLM");

  // Mesmo caminho do pipeline: so os candidatos vao ao LLM, e sem veredito vale a regra.
  const candidates = rows.filter((r) => isRelevant(r.objeto) || hasItVocabulary(r.objeto));
  const verdicts = await classifyAll(
    candidates.map((r) => ({ id: r.id, objeto: r.objeto })),
    { config: llm, log: console.log, batchSize },
  );
  const byObjeto = new Map(
    rows.map((r) => {
      const verdict = verdicts.get(r.id);
      const candidate = candidates.includes(r);
      return [r.objeto, candidate ? (verdict?.relevante ?? isRelevant(r.objeto)) : false] as const;
    }),
  );
  predict = (objeto) => byObjeto.get(objeto) ?? false;
  motivos = new Map([...verdicts].map(([id, v]) => [id, v.motivo]));
  console.log(
    `modelo=${llm.model} lote=${batchSize} candidatos=${candidates.length}/${rows.length} ` +
      `classificados=${verdicts.size}\n`,
  );
}

for (const row of rows) {
  const { score, hits } = scoreRelevance(row.objeto);
  const mark = predict(row.objeto) === row.relevante ? "ok  " : "ERRO";
  const motivo = motivos.has(row.id) ? ` llm: ${motivos.get(row.id)}` : "";
  console.log(`${mark} ${row.id} score=${score} [${hits.join(", ")}]${motivo}`);
}

const m = computeMetrics(rows, predict);
console.log(
  `\n${path}${useLlm ? " (regras + LLM)" : ""}: recall ${(m.recall * 100).toFixed(1)}% | ` +
    `precisao ${(m.precision * 100).toFixed(1)}% (VP=${m.truePositives} FP=${m.falsePositives} FN=${m.falseNegatives})`,
);
