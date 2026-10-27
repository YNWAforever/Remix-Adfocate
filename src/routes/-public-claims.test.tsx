import type { ComponentType, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "@/lib/i18n";
import { progressToNext } from "@/lib/levels";
import { mockCreatorPassport } from "@/data/mockData";
import type { AcademyTrack } from "@/lib/academy";

const h = vi.hoisted(() => ({
  info: vi.fn(), success: vi.fn(), fetchTrack: vi.fn(),
  me: { level: "L0", is_trusted: false },
}));
vi.mock("sonner", () => ({ toast: { info: h.info, success: h.success } }));
vi.mock("@/lib/activationAnalytics", () => ({ getDeviceCategory: () => "desktop", trackActivationEvent: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  Link: ({ to, params, children, ...props }: { to: string; params?: Record<string, string>; children: ReactNode }) =>
    <a href={to.replace(/\$(\w+)/g, (_, key) => params?.[key] ?? key)} {...props}>{children}</a>,
  Outlet: () => <p>Page content</p>,
  redirect: (o: unknown) => o,
  useParams: () => ({ trackId: "owned-track" }),
}));
vi.mock("@/components/marketing/MarketingHeader", () => ({ MarketingHeader: () => null }));
vi.mock("@/components/marketing/Footer", () => ({ Footer: () => null }));
vi.mock("@/lib/queries/kocmax", () => ({ useMe: () => ({ data: h.me }) }));
vi.mock("@/lib/academy", async (original) => ({ ...(await original<object>()), fetchAcademyTrack: h.fetchTrack }));

import { Route as Home } from "./_site.index";
import { Route as Creators } from "./_site.creators";
import { Route as Contact } from "./_site.contact";
import { Route as Site } from "./_site";
import { Route as Track } from "./_app.guide.track.$trackId";
import { AcademyTrackCard } from "@/components/AcademyTrackCard";

function page(route: { options: { component?: unknown } }) {
  const Component = route.options.component as ComponentType;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><I18nProvider><Component /></I18nProvider></QueryClientProvider>);
}
const track: AcademyTrack = {
  id: "owned", kind: "track", slug: "owned-track", title: "課程示範", excerpt: "課程簡介，並非課堂正文。",
  body: "", requiredLevel: "L0", emoji: "🌱", color: "pink", sort: 0,
  meta: { duration: "4堂課", levelLabel: "L0–L1", teaser_zh: "解鎖內容" },
};
beforeEach(() => { vi.clearAllMocks(); localStorage.setItem("lang", "en"); h.me = { level: "L0", is_trusted: false }; });

describe("D14 public promises", () => {
  it("derives the 3,840 XP demonstration from the canonical thresholds", () => {
    const p = progressToNext(mockCreatorPassport.xp);
    expect(mockCreatorPassport.level).toBe(p.current.id);
    expect(mockCreatorPassport.xpNext).toBe(p.next!.xpRequired);
    expect([p.current.id, p.next!.id, p.pct]).toEqual(["L2", "L3", 46]);
  });
  for (const [name, route] of [["home", Home], ["creators", Creators]] as const) {
    it(`${name}: labels fictional data and shows the canonical localized level and progress`, async () => {
      const { container } = page(route);
      expect(await screen.findAllByText(/Illustrative profile · fictional data/)).not.toHaveLength(0);
      expect(screen.getAllByText(/L2 Trusted KOC/).length).toBeGreaterThan(0);
      expect(container.textContent).toMatch(/3,840\s*\/\s*6,000/);
      const bars = container.querySelectorAll(".xp-bar-fill");
      expect(bars.length).toBeGreaterThan(0);
      for (const bar of bars) expect(bar).toHaveStyle({ width: "46%" });
      expect(container.textContent).not.toMatch(/77%|5,200\+|120\+|Lifetime withdrawable earnings|withdraw real HK\$/);
    });
  }
  it("marks the public experience as a preview and states pending reward is not payment", async () => {
    page(Site);
    expect(await screen.findByRole("note", { name: "Product preview" })).toHaveTextContent(/Pending reward is not payment/);
  });
  it("previews earning concepts in Chinese without offering real withdrawals", async () => {
    localStorage.setItem("lang", "zh"); const { container } = page(Home);
    await waitFor(() => expect(container.textContent).not.toContain("提取真實港幣"));
    expect(container.textContent).toContain("待處理獎勵，並不等於付款");
  });
  for (const lang of ["en", "zh"] as const) it(`previews earning resources with a clear preparation label (${lang})`, async () => {
    localStorage.setItem("lang", lang); page(Creators);
    expect(await screen.findByText(lang === "en" ? "Course topics preview · content in preparation" : "課程主題預覽 · 內容準備中")).toBeInTheDocument();
  });
  for (const lang of ["en", "zh"] as const) {
    it(`contact ${lang}: preview submission preserves inputs, sends nothing and never claims receipt or storage`, async () => {
      localStorage.setItem("lang", lang);
      const { container, unmount } = page(Contact);
      const button = await screen.findByRole("button", { name: lang === "en" ? "Preview form" : "預覽表格" });
      fireEvent.change(container.querySelector('input[name="name"]')!, { target: { value: "Retained draft" } });
      fireEvent.change(container.querySelector('input[name="email"]')!, { target: { value: "preview@example.invalid" } });
      const fetch = vi.spyOn(globalThis, "fetch");
      const persist = vi.spyOn(Storage.prototype, "setItem");
      fireEvent.submit(button.closest("form")!);
      expect(h.info).toHaveBeenCalledWith(lang === "en" ? "Preview only. Nothing was sent or saved." : "僅供預覽，沒有發送或儲存任何資料。");
      expect(h.success).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
      expect(persist).not.toHaveBeenCalled();
      expect(container.querySelector('input[name="name"]')).toHaveValue("Retained draft");
      expect(container.textContent).not.toMatch(/Received|we got it|recorded your interest|已收到|收到喇|本機記低|24h|真人回覆/);
      fetch.mockRestore(); persist.mockRestore(); unmount();
      const fresh = page(Contact);
      expect(fresh.container.querySelector('input[name="name"]')).toHaveValue("");
      expect(fresh.container.textContent).not.toMatch(/Received|we got it|已收到|收到喇/);
    });
  }
});

describe("D14 Academy availability is separate from eligibility", () => {
  it("empty body: preserves the labelled introduction, shows preparing and ignores the four-lesson metadata", async () => {
    localStorage.setItem("lang", "zh"); h.fetchTrack.mockResolvedValue({ item: track });
    page(Track);
    expect(await screen.findByText("內容準備中")).toBeInTheDocument();
    expect(screen.getByText(track.excerpt!)).toBeInTheDocument();
    expect(screen.queryByText(/4堂課|開始課程/)).not.toBeInTheDocument();
  });
  it("available body is readable Markdown, without inventing lesson counts or progress", async () => {
    h.fetchTrack.mockResolvedValue({ item: { ...track, body: "## Actual reading\n\nOwner-approved fixture content." } });
    page(Track);
    expect(await screen.findByRole("heading", { name: "Actual reading" })).toBeInTheDocument();
    expect(screen.queryByText(/4堂課|100%|Start course/)).not.toBeInTheDocument();
  });
  it("keeps the social trust gate for an eligible level", async () => {
    localStorage.setItem("lang", "zh"); h.me = { level: "L3", is_trusted: false };
    h.fetchTrack.mockResolvedValue({ item: { ...track, requiredLevel: "L2", body: "Private lesson body" } });
    page(Track);
    expect(await screen.findByRole("link", { name: /立即驗證/ })).toHaveAttribute("href", "/profile");
    expect(screen.queryByText("Private lesson body")).not.toBeInTheDocument();
  });
  it("offers an introduction link for an unfinished track without promising four lessons", () => {
    render(<I18nProvider><AcademyTrackCard track={track} creatorLevel="L0" isTrusted={false} /></I18nProvider>);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/guide/track/owned-track");
    expect(screen.getByText(/Content preparing/)).toBeInTheDocument();
    expect(screen.queryByText(/4堂課/)).not.toBeInTheDocument();
  });
  it("recovers from a transient read error without mislabelling it as a missing course", async () => {
    localStorage.setItem("lang", "zh");
    h.fetchTrack.mockRejectedValueOnce(new Error("Temporary service failure"))
      .mockResolvedValueOnce({ item: { ...track, body: "Recovered reading content" } });
    page(Track);
    const retry = await screen.findByRole("button", { name: "重試" });
    expect(screen.queryByText("找不到課程。")).not.toBeInTheDocument();
    fireEvent.click(retry);
    expect(await screen.findByText("Recovered reading content")).toBeInTheDocument();
  });
});
