import { mkdir, writeFile } from "node:fs/promises";

const BASE = "https://pncp.gov.br/api/consulta/v1/contratacoes/proposta";
const OUT_DIR = "tests/fixtures";

const recordings = [
  { file: "proposta-mg-mod6-p1.json", modalidade: 6, pagina: 1 },
  { file: "proposta-mg-mod6-p2.json", modalidade: 6, pagina: 2 },
  { file: "proposta-mg-mod8-p1.json", modalidade: 8, pagina: 1 },
  { file: "proposta-mg-mod4-p1.json", modalidade: 4, pagina: 1 },
];

await mkdir(OUT_DIR, { recursive: true });

for (const r of recordings) {
  const params = new URLSearchParams({
    dataFinal: "20261231",
    uf: "MG",
    codigoModalidadeContratacao: String(r.modalidade),
    pagina: String(r.pagina),
    tamanhoPagina: "10",
  });
  const res = await fetch(`${BASE}?${params}`, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${r.file}: HTTP ${res.status}`);
  const body = await res.json();
  await writeFile(`${OUT_DIR}/${r.file}`, JSON.stringify(body, null, 2) + "\n");
  console.log(`${r.file}: ${body.data.length} registros (total ${body.totalRegistros})`);
}
