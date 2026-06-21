import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown";

describe("Markdown", () => {
  it("renders headings and lists", () => {
    render(<Markdown source={"# 標題\n\n- 一\n- 二"} />);
    expect(screen.getByRole("heading", { name: "標題" })).toBeInTheDocument();
    expect(screen.getByText("一")).toBeInTheDocument();
  });

  it("sanitizes dangerous html", () => {
    const { container } = render(<Markdown source={"安全<script>window.x=1</script><img src=x onerror=\"window.y=1\">"} />);
    expect(container.querySelector("script")).toBeNull();
    const img = container.querySelector("img");
    // rehype-sanitize either removes the img entirely or strips the onerror attr
    expect(img == null || img.getAttribute("onerror") === null).toBe(true);
  });
});
