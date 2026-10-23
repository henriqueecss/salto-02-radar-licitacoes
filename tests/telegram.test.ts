import { describe, expect, it, vi } from "vitest";
import { sendMessages } from "../src/telegram/client.ts";

const TOKEN = "123456:TOKEN-DE-TESTE";
const ok = () => new Response(JSON.stringify({ ok: true }), { status: 200 });
const sleep = vi.fn(async () => {});

describe("sendMessages", () => {
  it("envia cada mensagem em ordem com parse_mode HTML", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => ok());
    await sendMessages(["a", "b"], { token: TOKEN, chatId: "-100", fetchFn, sleep });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(String(url)).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({ chat_id: "-100", text: "a", parse_mode: "HTML" });
    expect(JSON.parse(String(fetchFn.mock.calls[1]?.[1]?.body)).text).toBe("b");
  });

  it("respeita retry_after quando o Telegram devolve 429", async () => {
    const sleepSpy = vi.fn(async () => {});
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, parameters: { retry_after: 7 } }), { status: 429 }),
      )
      .mockResolvedValueOnce(ok());
    await sendMessages(["a"], { token: TOKEN, chatId: "-100", fetchFn, sleep: sleepSpy });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sleepSpy).toHaveBeenCalledWith(7000);
  });

  it("falha sem expor o token na mensagem de erro", async () => {
    const fetchFn = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }), { status: 400 }),
    );
    const error = await sendMessages(["a"], { token: TOKEN, chatId: "-100", fetchFn, sleep }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("chat not found");
    expect((error as Error).message).not.toContain(TOKEN);
  });

  it("falha de rede tambem nao expoe o token", async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw new TypeError(`fetch failed for https://api.telegram.org/bot${TOKEN}/sendMessage`);
    });
    const error = await sendMessages(["a"], { token: TOKEN, chatId: "-100", fetchFn, sleep }).catch((e: Error) => e);
    expect((error as Error).message).not.toContain(TOKEN);
  });
});
