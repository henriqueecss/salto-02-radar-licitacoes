import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { loadConfig } from "../src/config.ts";
import { loadLabeledCsv } from "../src/eval.ts";
import { buildRequest } from "../src/llm/classify.ts";

// Grava uma chamada real ao LLM (corpo enviado e resposta, sem a chave) para os testes.
const OUT = "tests/fixtures/llm-groq-lote.json";
const SAMPLE_IDS = ["R01", "R08", "R14", "I01", "I04", "I12"];

if (existsSync(".env")) process.loadEnvFile(".env");
const llm = loadConfig({ ...process.env, RADAR_DRY_RUN: "1" }).llm;
if (!llm) throw new Error("Defina API_KEY no .env para gravar a fixture");

const rows = loadLabeledCsv("data/objetos_rotulados.csv").filter((r) => SAMPLE_IDS.includes(r.id));
const request = buildRequest(
  rows.map((r) => r.objeto),
  llm.model,
);

const res = await fetch(`${llm.baseUrl}/chat/completions`, {
  method: "POST",
  headers: { authorization: `Bearer ${llm.apiKey}`, "content-type": "application/json" },
  body: JSON.stringify(request),
  signal: AbortSignal.timeout(60_000),
});
if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
const response = await res.json();

await mkdir("tests/fixtures", { recursive: true });
await writeFile(OUT, JSON.stringify({ ids: rows.map((r) => r.id), request, response }, null, 2) + "\n");
console.log(`${OUT}: ${rows.length} objetos, modelo ${llm.model}`);
console.log(response.choices?.[0]?.message?.content);
