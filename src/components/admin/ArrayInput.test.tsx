import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ArrayInput } from "./ArrayInput";

describe("ArrayInput", () => {
  it("adds a chip on Enter and clears the input", () => {
    const onChange = vi.fn();
    render(<ArrayInput value={[]} onChange={onChange} placeholder="add" />);
    const input = screen.getByPlaceholderText("add");
    fireEvent.change(input, { target: { value: "  hello " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["hello"]);
  });

  it("does not add empty/whitespace values", () => {
    const onChange = vi.fn();
    render(<ArrayInput value={[]} onChange={onChange} placeholder="add" />);
    const input = screen.getByPlaceholderText("add");
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes a chip by index", () => {
    const onChange = vi.fn();
    render(<ArrayInput value={["a", "b"]} onChange={onChange} placeholder="add" />);
    fireEvent.click(screen.getByLabelText("remove b"));
    expect(onChange).toHaveBeenCalledWith(["a"]);
  });
});
