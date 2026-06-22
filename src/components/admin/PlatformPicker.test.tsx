import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlatformPicker } from "./PlatformPicker";

describe("PlatformPicker", () => {
  it("toggles a known platform on", () => {
    const onChange = vi.fn();
    render(<PlatformPicker value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /instagram/i }));
    expect(onChange).toHaveBeenCalledWith(["instagram"]);
  });

  it("toggles a known platform off when already selected", () => {
    const onChange = vi.fn();
    render(<PlatformPicker value={["instagram"]} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /instagram/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("adds a custom platform via the escape-hatch input", () => {
    const onChange = vi.fn();
    render(<PlatformPicker value={[]} onChange={onChange} />);
    const input = screen.getByPlaceholderText("其他平台…");
    fireEvent.change(input, { target: { value: "threads" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["threads"]);
  });
});
