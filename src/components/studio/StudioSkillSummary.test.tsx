import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";

const h = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock("@/lib/api", async original => ({ ...await original<object>(), apiFetch: h.apiFetch }));
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({ lang: "zh" }) }));

import { StudioSkillSummary } from "./StudioSkillSummary";

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><StudioSkillSummary /></QueryClientProvider>);
}

describe("studio data-skill summary", () => {
  it("shows connected and pending skills with a manage link", async () => {
    h.apiFetch.mockResolvedValue({
      available: true,
      skills: [
        { id: "s1", name: "mysocial", tools: ["search_content"], consented: true, connected: true, auth_mode: "oauth" },
        { id: "s2", name: "notes", tools: ["read"], consented: false },
      ],
    });
    mount();
    expect(await screen.findByText(/mysocial/)).toHaveTextContent("已連接");
    expect(screen.getByText(/notes/)).toHaveTextContent("未允許");
    expect(screen.getByRole("link", { name: "管理" })).toHaveAttribute("href", "/connections#data-skills");
    expect(screen.getByText("技能會在討論中自動使用，不會列作證據來源。")).toBeVisible();
  });

  it("renders nothing when MCP is unavailable", async () => {
    h.apiFetch.mockRejectedValue(new ApiError(404, "mcp_disabled", "off"));
    const { container } = mount();
    await vi.waitFor(() => expect(h.apiFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
