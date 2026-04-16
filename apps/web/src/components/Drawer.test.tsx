// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Drawer } from "./Drawer";

// Mock next/navigation's usePathname because Drawer closes on route change.
let mockPathname = "/a";
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
}));

beforeEach(() => {
  mockPathname = "/a";
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = "";
});

describe("Drawer", () => {
  it("renders children when open", () => {
    render(
      <Drawer open onClose={() => {}} side="left">
        <p>hello</p>
      </Drawer>,
    );
    expect(screen.getByText("hello")).toBeDefined();
  });

  it("does not render children when closed", () => {
    render(
      <Drawer open={false} onClose={() => {}} side="left">
        <p>hello</p>
      </Drawer>,
    );
    expect(screen.queryByText("hello")).toBeNull();
  });

  it("calls onClose on backdrop click", () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose} side="right">
        <p>body</p>
      </Drawer>,
    );
    fireEvent.click(screen.getByTestId("drawer-backdrop"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape key", () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose} side="left">
        <p>body</p>
      </Drawer>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("locks body scroll while open and restores on close", () => {
    const { rerender } = render(
      <Drawer open onClose={() => {}} side="left">
        <p>body</p>
      </Drawer>,
    );
    expect(document.body.style.overflow).toBe("hidden");
    rerender(
      <Drawer open={false} onClose={() => {}} side="left">
        <p>body</p>
      </Drawer>,
    );
    expect(document.body.style.overflow).toBe("");
  });
});
