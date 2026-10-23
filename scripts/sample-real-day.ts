import { mkdir, writeFile } from "node:fs/promises";
import { rejectionReason } from "../src/filter/criteria.ts";
import { scoreRelevance, THRESHOLD } from "../src/filter/relevance.ts";
import { fetchOpenContratacoes } from "../src/pncp/client.ts";
import { normalizeContratacao } from "../src/pncp/normalize.ts";

// Monta a amostra para rotulagem manual: aprovados pelo filtro (mede precisao)
// e rejeitados com algum termo positivo (onde um falso negativo se esconderia).
const SIZE_APPROVED = 10;
const SIZE_NEAR_MISS = 10;
const OUT = "avaliacao/amostra_dia_real.csv";

const now = new Date();
const dataFinal = `${now.getUTCFullYear() + 1}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
const raw = await fetchOpenContratacoes({ uf: process.env.RADAR_UF || "MG", modalidades: [6, 8, 4], dataFinal });
const editais = raw.map(normalizeContratacao);
const criteria = { uf: process.env.RADAR_UF || "MG", valorMin: 0, valorMax: null, now };

// Criterios objetivos aplicados; a amostra avalia so a relevancia do objeto.
const eligible = editais.filter((e) => {
  const reason = rejectionReason(e, criteria);
  return reason === null || reason === "relevancia";
});
const scored = eligible.map((e) => ({ e, ...scoreRelevance(e.objeto) }));

const shuffle = <T>(xs: T[]) => xs.map((x) => [Math.random(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
const approved = shuffle(scored.filter((s) => s.score >= THRESHOLD)).slice(0, SIZE_APPROVED);
const nearMiss = shuffle(scored.filter((s) => s.score < THRESHOLD && s.hits.length > 0 && s.score > -3)).slice(
  0,
  SIZE_APPROVED + SIZE_NEAR_MISS - approved.length,
);

const rows = shuffle([...approved, ...nearMiss]).map((s) =>
  [s.e.id, s.e.objeto.replace(/;/g, ","), "", s.score >= THRESHOLD ? "sim" : "não", s.score, s.e.link].join(";"),
);
await mkdir("avaliacao", { recursive: true });
await writeFile(OUT, ["id;objeto;relevante;previsto;score;link", ...rows].join("\n") + "\n");

console.log(
  `coletados=${editais.length} elegiveis=${eligible.length} aprovados=${scored.filter((s) => s.score >= THRESHOLD).length}`,
);
console.log(`amostra: ${approved.length} aprovados + ${nearMiss.length} quase aprovados em ${OUT}`);
console.log('preencha a coluna "relevante" com sim/não e rode: npm run evaluate -- ' + OUT);
