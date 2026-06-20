import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { LangToggle } from "./LangToggle";

function setup() {
  window.localStorage.clear();
  return render(
    <I18nProvider>
      <LangToggle />
    </I18nProvider>,
  );
}

describe("LangToggle", () => {
  it("shows the other language label and toggles + persists", () => {
    setup();
    const btn = screen.getByRole("button", { name: /toggle language/i });
    // zh default → button offers English ("EN")
    expect(btn).toHaveTextContent("EN");
    fireEvent.click(btn);
    expect(window.localStorage.getItem("lang")).toBe("en");
    expect(btn).toHaveTextContent("中");
  });
});
