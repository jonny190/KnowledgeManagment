import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphEmailProvider, __resetGraphCacheForTests } from "../providers/graph";

const tokenJson = (expiresIn = 3600) => ({
  token_type: "Bearer",
  expires_in: expiresIn,
  access_token: "FAKE_TOKEN",
});

describe("GraphEmailProvider", () => {
  beforeEach(() => {
    process.env.GRAPH_TENANT_ID = "tenant";
    process.env.GRAPH_CLIENT_ID = "client";
    process.env.GRAPH_CLIENT_SECRET = "secret";
    process.env.EMAIL_FROM_MAILBOX = "noreply@example.com";
    __resetGraphCacheForTests();
  });

  afterEach(() => vi.restoreAllMocks());

  it("acquires a token and sends via /sendMail", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(tokenJson()), { status: 200 }))
      .mockResolvedValueOnce(new Response("", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    const p = new GraphEmailProvider();
    const res = await p.send({
      to: "a@b.com",
      kind: "VERIFY_EMAIL",
      data: { verifyUrl: "https://app/v?t=x" },
    });

    expect(res.provider).toBe("graph");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [tokenUrl] = fetchMock.mock.calls[0];
    expect(String(tokenUrl)).toContain("login.microsoftonline.com/tenant/oauth2/v2.0/token");
    const [sendUrl, sendInit] = fetchMock.mock.calls[1];
    expect(String(sendUrl)).toBe("https://graph.microsoft.com/v1.0/users/noreply@example.com/sendMail");
    expect((sendInit as RequestInit).headers).toMatchObject({ Authorization: "Bearer FAKE_TOKEN" });
  });

  it("reuses a cached token across calls", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(tokenJson()), { status: 200 }))
      .mockResolvedValueOnce(new Response("", { status: 202 }))
      .mockResolvedValueOnce(new Response("", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const p = new GraphEmailProvider();
    await p.send({ to: "a@b.com", kind: "VERIFY_EMAIL", data: { verifyUrl: "u" } });
    await p.send({ to: "c@d.com", kind: "VERIFY_EMAIL", data: { verifyUrl: "u" } });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws TerminalGraphError on 401 from sendMail", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(tokenJson()), { status: 200 }))
      .mockResolvedValueOnce(new Response("nope", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const p = new GraphEmailProvider();
    await expect(
      p.send({ to: "a@b.com", kind: "VERIFY_EMAIL", data: { verifyUrl: "u" } }),
    ).rejects.toMatchObject({ terminal: true });
  });
});
