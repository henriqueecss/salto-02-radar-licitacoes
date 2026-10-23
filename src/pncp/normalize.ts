import { cleanText } from "../filter/text.ts";

export type PncpContratacao = {
  numeroControlePNCP: string;
  objetoCompra: string | null;
  valorTotalEstimado: number | null;
  modalidadeId: number;
  modalidadeNome: string;
  dataAberturaProposta: string | null;
  dataEncerramentoProposta: string | null;
  situacaoCompraId: number;
  situacaoCompraNome: string;
  orgaoEntidade: { cnpj: string; razaoSocial: string };
  unidadeOrgao: { municipioNome: string; ufSigla: string; codigoIbge: string };
  linkSistemaOrigem: string | null;
};

export type PncpPage = {
  data: PncpContratacao[];
  totalRegistros: number;
  totalPaginas: number;
  numeroPagina: number;
  paginasRestantes: number;
};

export type Edital = {
  id: string;
  objeto: string;
  orgao: string;
  municipio: string;
  uf: string;
  modalidade: string;
  valorEstimado: number | null;
  situacaoId: number;
  abertura: Date | null;
  encerramento: Date | null;
  prazoConfiavel: boolean;
  link: string;
  linkOrigem: string | null;
};

// O PNCP manda datas sem fuso, em horario de Brasilia (sem horario de verao desde 2019).
export function parseBrasiliaDate(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const date = new Date(`${value}-03:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

// "18278051000145-1-000133/2026" -> https://pncp.gov.br/app/editais/18278051000145/2026/133
export function pncpUrl(numeroControle: string): string {
  const match = /^(\d{14})-\d+-(\d+)\/(\d{4})$/.exec(numeroControle);
  if (!match) return "https://pncp.gov.br/app/editais";
  const [, cnpj, sequencial, ano] = match;
  return `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${Number(sequencial)}`;
}

// Alguns orgaos preenchem abertura e encerramento em 31/12 como valor de mentira.
function isPlaceholderDeadline(abertura: string | null, encerramento: string | null): boolean {
  if (!encerramento) return false;
  const day = encerramento.slice(0, 10);
  return day.endsWith("-12-31") && abertura?.slice(0, 10) === day;
}

export function normalizeContratacao(raw: PncpContratacao): Edital {
  return {
    id: raw.numeroControlePNCP,
    objeto: cleanText(raw.objetoCompra ?? ""),
    orgao: cleanText(raw.orgaoEntidade.razaoSocial),
    municipio: raw.unidadeOrgao.municipioNome,
    uf: raw.unidadeOrgao.ufSigla,
    modalidade: raw.modalidadeNome,
    valorEstimado: raw.valorTotalEstimado ? raw.valorTotalEstimado : null,
    situacaoId: raw.situacaoCompraId,
    abertura: parseBrasiliaDate(raw.dataAberturaProposta),
    encerramento: parseBrasiliaDate(raw.dataEncerramentoProposta),
    prazoConfiavel: !isPlaceholderDeadline(raw.dataAberturaProposta, raw.dataEncerramentoProposta),
    link: pncpUrl(raw.numeroControlePNCP),
    linkOrigem: raw.linkSistemaOrigem || null,
  };
}
