import { describe, expect, it, vi } from "vitest";
import { ConsoleEmailProvider } from "../providers/console";

describe("ConsoleEmailProvider", () => {
  it("logs a rendered verify email and returns a stub id", async () => {
    const logs: unknown[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args);
    });
    const p = new ConsoleEmailProvider();
    const res = await p.send({
      to: "a@b.com",
      kind: "VERIFY_EMAIL",
      data: { verifyUrl: "https://app/verify-email?token=x" },
    });
    expect(res.provider).toBe("console");
    expect(res.providerId).toMatch(/^console-/);
    expect(JSON.stringify(logs)).toContain("https://app/verify-email?token=x");
    spy.mockRestore();
  });
});
