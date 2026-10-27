import { describe, expect, it } from "vitest";
import { buildMessages, escapeHtml, TELEGRAM_LIMIT } from "../src/telegram/format.ts";
import { normalizeContratacao } from "../src/pncp/normalize.ts";
import type { Scored } from "../src/store/db.ts";
import { rawContratacao } from "./helpers.ts";

const now = new Date("2026-10-23T11:00:00Z");
const plain = (s: string) => s.replace(/ /g, " ");

const item = (seq: number, overrides: Parameters<typeof rawContratacao>[0] = {}, score = 5): Scored => ({
  edital: normalizeContratacao(
    rawContratacao({ numeroControlePNCP: `18338152000164-1-${String(seq).padStart(6, "0")}/2026`, ...overrides }),
  ),
  score,
});

describe("escapeHtml", () => {
  it("escapa os caracteres que o parse_mode=HTML do Telegram exige", () => {
    expect(escapeHtml(`a < b & c > "d"`)).toBe("a &lt; b &amp; c &gt; &quot;d&quot;");
  });
});

describe("buildMessages", () => {
  it("avisa quando nao ha nada novo", () => {
    const [msg, ...rest] = buildMessages([], now);
    expect(rest).toHaveLength(0);
    expect(msg).toContain("Nenhum edital novo hoje");
    expect(msg).toContain("23/10/2026");
  });

  it("mostra objeto, orgao, municipio, valor, prazo e link", () => {
    const [msg] = buildMessages([item(55, { valorTotalEstimado: 105736.68 })], now);
    expect(msg).toContain("1 edital novo");
    expect(msg).toContain("Desenvolvimento de sistema web para a prefeitura");
    expect(msg).toContain("MUNICIPIO DE CORONEL PACHECO");
    expect(msg).toContain("Coronel Pacheco/MG");
    expect(plain(msg ?? "")).toContain("R$ 105.736,68");
    expect(msg).toContain("03/11/2026 09:00");
    expect(msg).toContain('<a href="https://pncp.gov.br/app/editais/18338152000164/2026/55">');
  });

  it("valor ausente aparece como sigiloso ou nao informado", () => {
    const [msg] = buildMessages([item(1, { valorTotalEstimado: 0 })], now);
    expect(msg).toContain("sigiloso ou não informado");
  });

  it("prazo de preenchimento aparece como a confirmar", () => {
    const [msg] = buildMessages(
      [item(1, { dataAberturaProposta: "2026-12-31T08:00:00", dataEncerramentoProposta: "2026-12-31T09:00:00" })],
      now,
    );
    expect(msg).toContain("a confirmar no edital");
    expect(msg).not.toContain("31/12/2026");
  });

  it("destaca edital que encerra em ate 3 dias", () => {
    const [msg] = buildMessages([item(1, { dataEncerramentoProposta: "2026-10-25T09:00:00" })], now);
    expect(msg).toContain("encerra em breve");
  });

  it("mostra o motivo do LLM quando houver", () => {
    const [msg] = buildMessages([{ ...item(1), motivo: "Desenvolvimento de <site> institucional" }], now);
    expect(msg).toContain("Motivo: Desenvolvimento de &lt;site&gt; institucional");
    const [semMotivo] = buildMessages([item(1)], now);
    expect(semMotivo).not.toContain("Motivo:");
  });

  it("escapa HTML vindo do objeto", () => {
    const [msg] = buildMessages([item(1, { objetoCompra: "Sistema <web> & app" })], now);
    expect(msg).toContain("Sistema &lt;web&gt; &amp; app");
  });

  it("ordena por pontuacao, maior primeiro", () => {
    const [msg = ""] = buildMessages(
      [item(1, { objetoCompra: "baixo" }, 3), item(2, { objetoCompra: "alto" }, 9)],
      now,
    );
    expect(msg.indexOf("alto")).toBeLessThan(msg.indexOf("baixo"));
  });

  it("marca porte alto a partir de R$ 5 milhoes, sem esconder o edital", () => {
    const [msg = ""] = buildMessages([item(1, { valorTotalEstimado: 13100481.34 })], now);
    expect(msg).toContain("[porte alto]");
    expect(plain(msg)).toContain("R$ 13.100.481,34");
  });

  it("avisa quando o objeto indica trabalho presencial, sem esconder o edital", () => {
    const [msg = ""] = buildMessages([item(1, { objetoCompra: "Manutenção de sistema com técnico residente" })], now);
    expect(msg).toContain("[presencial]");
    expect(msg).toContain("técnico residente");
    const [remoto = ""] = buildMessages([item(1)], now);
    expect(remoto).not.toContain("presencial");
  });

  it("nao marca porte alto abaixo do limite nem sem valor", () => {
    const [abaixo = ""] = buildMessages([item(1, { valorTotalEstimado: 4999999 })], now);
    const [sigiloso = ""] = buildMessages([item(1, { valorTotalEstimado: 0 })], now);
    expect(abaixo).not.toContain("porte alto");
    expect(sigiloso).not.toContain("porte alto");
  });

  it("deixa os de porte alto por ultimo, mesmo com pontuacao maior", () => {
    const [msg = ""] = buildMessages(
      [
        item(1, { objetoCompra: "gigante", valorTotalEstimado: 271899111.48 }, 9),
        item(2, { objetoCompra: "pequeno", valorTotalEstimado: 45000 }, 3),
        item(3, { objetoCompra: "medio", valorTotalEstimado: 800000 }, 6),
      ],
      now,
    );
    expect(msg.indexOf("medio")).toBeLessThan(msg.indexOf("gigante"));
    expect(msg.indexOf("pequeno")).toBeLessThan(msg.indexOf("gigante"));
    expect(msg.indexOf("medio")).toBeLessThan(msg.indexOf("pequeno"));
  });

  it("divide em mensagens de ate 4096 caracteres sem cortar edital e numera as partes", () => {
    const longText = "Desenvolvimento de sistema web ".repeat(30);
    const items = Array.from({ length: 60 }, (_, i) => item(i + 1, { objetoCompra: `#${i + 1} ${longText}` }));
    const msgs = buildMessages(items, now);

    expect(msgs.length).toBeGreaterThan(1);
    msgs.forEach((m, i) => {
      expect(m.length).toBeLessThanOrEqual(TELEGRAM_LIMIT);
      expect(m).toContain(`(${i + 1}/${msgs.length})`);
    });
    for (let seq = 1; seq <= 60; seq++) {
      const link = `/2026/${seq}"`;
      const holders = msgs.filter((m) => m.includes(link));
      expect(holders).toHaveLength(1);
      expect(holders[0]).toContain(`#${seq}`);
    }
  });
});
