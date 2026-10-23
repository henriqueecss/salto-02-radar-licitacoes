import type { Edital } from "../pncp/normalize.ts";
import type { Scored } from "../store/db.ts";

export const TELEGRAM_LIMIT = 4096;
const MAX_OBJETO = 350;
const MAX_MOTIVO = 200;
const URGENT_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short" });
const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  dateStyle: "short",
  timeStyle: "short",
});

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function formatPrazo(e: Edital, now: Date): string {
  if (!e.encerramento || !e.prazoConfiavel) return "Prazo: a confirmar no edital";
  const days = Math.ceil((e.encerramento.getTime() - now.getTime()) / DAY_MS);
  const urgent = days <= URGENT_DAYS ? " <b>[encerra em breve]</b>" : "";
  return `Encerra: ${dateTimeFmt.format(e.encerramento).replace(",", "")}${urgent}`;
}

function formatItem({ edital: e, motivo }: Scored, index: number, now: Date): string {
  const valor = e.valorEstimado === null ? "sigiloso ou não informado" : money.format(e.valorEstimado);
  return [
    `<b>${index}. ${escapeHtml(truncate(e.objeto, MAX_OBJETO))}</b>`,
    `${escapeHtml(e.orgao)} · ${escapeHtml(e.municipio)}/${escapeHtml(e.uf)}`,
    `${escapeHtml(e.modalidade)} · Valor estimado: ${valor}`,
    formatPrazo(e, now),
    ...(motivo ? [`Motivo: ${escapeHtml(truncate(motivo, MAX_MOTIVO))}`] : []),
    `<a href="${escapeHtml(e.link)}">Ver no PNCP</a>`,
  ].join("\n");
}

function header(now: Date, total: number, part?: [number, number]): string {
  const title = `<b>Radar de licitações · ${dateFmt.format(now)}</b>`;
  const parts = part ? ` (${part[0]}/${part[1]})` : "";
  const count = total === 1 ? "1 edital novo" : `${total} editais novos`;
  return `${title}${parts}\n${count}`;
}

export function buildMessages(items: Scored[], now: Date): string[] {
  if (items.length === 0) return [`${header(now, 0).split("\n")[0]}\nNenhum edital novo hoje.`];

  const sorted = [...items].sort((a, b) => b.score - a.score);
  const blocks = sorted.map((item, i) => formatItem(item, i + 1, now));
  const separator = "\n\n";
  const budget = TELEGRAM_LIMIT - header(now, items.length, [999, 999]).length - separator.length;

  const chunks: string[][] = [[]];
  let size = 0;
  for (const block of blocks) {
    const current = chunks[chunks.length - 1]!;
    const added = block.length + (current.length > 0 ? separator.length : 0);
    if (current.length > 0 && size + added > budget) {
      chunks.push([block]);
      size = block.length;
    } else {
      current.push(block);
      size += added;
    }
  }

  return chunks.map((chunk, i) => {
    const part: [number, number] | undefined = chunks.length > 1 ? [i + 1, chunks.length] : undefined;
    return `${header(now, items.length, part)}${separator}${chunk.join(separator)}`;
  });
}
