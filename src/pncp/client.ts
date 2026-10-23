import { defaultRetry, fetchWithRetry, type RetryOptions } from "../http.ts";
import type { PncpContratacao, PncpPage } from "./normalize.ts";

const BASE_URL = "https://pncp.gov.br/api/consulta/v1/contratacoes/proposta";
// O swagger e a pratica (testado em 22/10/2026) aceitam no maximo 50.
const PAGE_SIZE = 50;

export type FetchOptions = {
  uf: string;
  modalidades: number[];
  dataFinal: string;
  fetchFn?: typeof fetch;
  retry?: RetryOptions;
};

export async function fetchOpenContratacoes(opts: FetchOptions): Promise<PncpContratacao[]> {
  const fetchFn = opts.fetchFn ?? fetch;
  const retry = opts.retry ?? defaultRetry;
  const all: PncpContratacao[] = [];

  let firstRequest = true;
  for (const modalidade of opts.modalidades) {
    for (let pagina = 1; ; pagina++) {
      if (!firstRequest && retry.pageDelayMs > 0) await retry.sleep(retry.pageDelayMs);
      firstRequest = false;
      const params = new URLSearchParams({
        dataFinal: opts.dataFinal,
        uf: opts.uf,
        codigoModalidadeContratacao: String(modalidade),
        pagina: String(pagina),
        tamanhoPagina: String(PAGE_SIZE),
      });
      const page = (await fetchWithRetry(`${BASE_URL}?${params}`, fetchFn, retry)) as PncpPage | null;
      if (!page || page.data.length === 0) break;
      all.push(...page.data);
      if (page.paginasRestantes <= 0) break;
    }
  }
  return all;
}
