import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { IdentityHeader } from "./IdentityHeader";

describe("IdentityHeader", () => {
  it("renders the name, the initial fallback, and children", () => {
    render(
      <IdentityHeader name="阿明" avatarUrl={null}>
        <span>child-slot</span>
      </IdentityHeader>,
    );
    expect(screen.getByRole("heading", { name: "阿明" })).toBeInTheDocument();
    expect(screen.getByText("阿")).toBeInTheDocument();
    expect(screen.getByText("child-slot")).toBeInTheDocument();
  });

  it("renders an avatar image and the actions slot when provided", () => {
    const { container } = render(
      <IdentityHeader name="阿明" avatarUrl="https://x/a.png" actions={<button>編輯</button>} />,
    );
    expect(container.querySelector("img")).toHaveAttribute("src", "https://x/a.png");
    expect(screen.getByRole("button", { name: "編輯" })).toBeInTheDocument();
  });
});
