// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePointerType } from "./usePointerType";

function mockMatchMedia(hoverMatches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === "(hover: hover)" ? hoverMatches : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("usePointerType", () => {
  it("returns 'mouse' when (hover: hover) matches", () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => usePointerType());
    expect(result.current).toBe("mouse");
  });

  it("returns 'touch' when (hover: hover) does not match", () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => usePointerType());
    expect(result.current).toBe("touch");
  });

  it("is SSR-safe: returns 'mouse' when window is undefined", () => {
    // Simulate SSR by checking the module-level guard used by the hook.
    // The hook's initial state defaults to 'mouse' when matchMedia is unavailable.
    const original = window.matchMedia;
    // @ts-expect-error force undefined
    delete window.matchMedia;
    const { result } = renderHook(() => usePointerType());
    expect(result.current).toBe("mouse");
    window.matchMedia = original;
  });
});
