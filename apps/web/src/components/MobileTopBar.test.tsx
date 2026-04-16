// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { MobileTopBar } from "./MobileTopBar";

afterEach(cleanup);

describe("MobileTopBar", () => {
  it("renders title in the centre", () => {
    render(<MobileTopBar title="My Note" buttons={[]} />);
    expect(screen.getByText("My Note")).toBeDefined();
  });

  it("renders each button and fires onClick", () => {
    const onFiles = vi.fn();
    const onChat = vi.fn();
    render(
      <MobileTopBar
        title="x"
        buttons={[
          { key: "files", label: "Files", onClick: onFiles },
          { key: "chat", label: "AI", onClick: onChat },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Files" }));
    fireEvent.click(screen.getByRole("button", { name: "AI" }));
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onChat).toHaveBeenCalledTimes(1);
  });

  it("is hidden at md+ via md:hidden class on the root", () => {
    const { container } = render(<MobileTopBar title="x" buttons={[]} />);
    expect(container.firstElementChild?.className).toContain("md:hidden");
  });
});
