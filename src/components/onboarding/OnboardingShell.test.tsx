import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OnboardingShell } from "./OnboardingShell";

function renderShell(overrides: Partial<React.ComponentProps<typeof OnboardingShell>> = {}) {
  const props: React.ComponentProps<typeof OnboardingShell> = {
    step: 2,
    totalSteps: 5,
    title: "Your interests",
    saveState: "idle",
    canGoBack: true,
    hasUnsavedChanges: false,
    onBack: vi.fn(),
    onDiscardAndBack: vi.fn(),
    onCancelDiscard: vi.fn(),
    children: <p>Step content</p>,
    ...overrides,
  };
  render(<OnboardingShell {...props} />);
  return props;
}

describe("OnboardingShell", () => {
  it("announces semantic five-step progress and save status", () => {
    renderShell({ step: 3, saveState: "saving" });

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "3");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "5");
    expect(screen.getByRole("status")).toHaveTextContent("儲存中");
    expect(screen.getByRole("heading", { name: "Your interests" })).toBeInTheDocument();
  });

  it("goes back immediately when the step is clean", () => {
    const props = renderShell();

    fireEvent.click(screen.getByRole("button", { name: "返回" }));

    expect(props.onBack).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("requires explicit discard when the step is dirty", () => {
    const props = renderShell({ hasUnsavedChanges: true });

    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    const confirmation = screen.getByRole("alertdialog");
    expect(confirmation).toBeInTheDocument();
    expect(confirmation).not.toHaveAttribute("aria-modal", "true");
    expect(props.onBack).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "捨棄更改" }));
    expect(props.onDiscardAndBack).toHaveBeenCalledOnce();
  });

  it("cancels discard without navigating", () => {
    const props = renderShell({ hasUnsavedChanges: true });

    fireEvent.click(screen.getByRole("button", { name: "返回" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(props.onCancelDiscard).toHaveBeenCalledOnce();
    expect(props.onDiscardAndBack).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
