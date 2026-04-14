import { describe, it, expect, vi } from "vitest";
import { loadPlugins } from "./loader";

describe("loadPlugins", () => {
  it("skips plugins whose url is not allow-listed", async () => {
    const res = await loadPlugins({
      urls: ["https://evil.example.com/p.js"],
      allowList: ["https://good.example.com"],
      origin: "https://app.example.com",
      vaultId: "v",
      userId: "u",
    });
    expect(res.loaded).toHaveLength(0);
    expect(res.errors[0].url).toBe("https://evil.example.com/p.js");
  });

  it("loads same-origin plugins by default", async () => {
    (globalThis as any).__plugin = {
      plugin: {
        id: "t",
        name: "T",
        version: "1.0.0",
        activate: vi.fn(),
      },
    };
    const res = await loadPlugins({
      urls: ["https://app.example.com/p.js"],
      allowList: [],
      origin: "https://app.example.com",
      vaultId: "v",
      userId: "u",
      importer: async () => (globalThis as any).__plugin,
    });
    expect(res.loaded).toHaveLength(1);
    expect((globalThis as any).__plugin.plugin.activate).toHaveBeenCalled();
  });
});
