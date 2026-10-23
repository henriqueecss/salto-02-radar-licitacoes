import { mkdir, writeFile } from "node:fs/promises";
import { rejectionReason } from "../src/filter/criteria.ts";
import { isRelevant } from "../src/filter/relevance.ts";
import { normalizeText } from "../src/filter/text.ts";
import { fetchOpenContratacoes } from "../src/pncp/client.ts";
import { normalizeContratacao } from "../src/pncp/normalize.ts";

// Amostra para rotulagem manual as cegas (sem a previsao do filtro no arquivo):
// - aprovados pelo filtro, para medir precisao;
// - rejeitados com vocabulario de TI, que e onde um falso negativo se esconderia.
// Editais sem nenhum termo de TI sao assumidos irrelevantes e ficam fora da amostra.
const SIZE_APPROVED = 10;
const SIZE_NEAR_MISS = 10;
const OUT = process.argv[2] ?? "avaliacao/amostra_dia_real.csv";

const IT_VOCABULARY =
  /\b(sistemas?|software|aplicativos?|app|sites?|sitio|portal|plataforma|digital|web|online|tecnologia da informacao|informatica|informatizad[oa]s?|dados|nuvem|chatbot|dashboard|painel)\b/;
const PLATFORM_PREFIX = /^\s*\[[^\]]*\]\s*-?\s*/;

const now = new Date();
const uf = process.env.RADAR_UF || "MG";
const dataFinal = `${now.getUTCFullYear() + 1}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
const editais = (await fetchOpenContratacoes({ uf, modalidades: [6, 8, 4], dataFinal })).map(normalizeContratacao);

// Criterios objetivos aplicados; a amostra avalia so a relevancia do objeto.
const eligible = editais.filter((e) => {
  const reason = rejectionReason(e, { uf, valorMin: 0, valorMax: null, now });
  return reason === null || reason === "relevancia";
});

const shuffle = <T>(xs: T[]) => xs.map((x) => [Math.random(), x] as const).sort((a, b) => a[0] - b[0]).map(([, x]) => x);
const approved = eligible.filter((e) => isRelevant(e.objeto));
const nearMiss = eligible.filter(
  (e) => !isRelevant(e.objeto) && IT_VOCABULARY.test(normalizeText(e.objeto.replace(PLATFORM_PREFIX, ""))),
);
const pickedApproved = shuffle(approved).slice(0, SIZE_APPROVED);
const pickedNearMiss = shuffle(nearMiss).slice(0, SIZE_APPROVED + SIZE_NEAR_MISS - pickedApproved.length);

const rows = shuffle([...pickedApproved, ...pickedNearMiss]).map((e) =>
  [e.id, e.objeto.replace(/;/g, ","), "", e.link].join(";"),
);
await mkdir("avaliacao", { recursive: true });
await writeFile(OUT, ["id;objeto;relevante;link", ...rows].join("\n") + "\n");

console.log(
  `coletados=${editais.length} elegiveis=${eligible.length} aprovados=${approved.length} ` +
    `rejeitados_com_vocabulario_ti=${nearMiss.length}`,
);
console.log(`amostra: ${pickedApproved.length} aprovados + ${pickedNearMiss.length} rejeitados com vocabulario de TI em ${OUT}`);
console.log('preencha a coluna "relevante" com sim/não e rode: npm run evaluate -- ' + OUT);
