import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mutate = vi.fn();
const hoisted = vi.hoisted(() => ({ state: { isPending: false, isError: false } }));
vi.mock("@/lib/queries/kocmax", () => ({ useRedeemGift: () => ({ mutate, ...hoisted.state }) }));

import { RedeemGiftCard } from "./RedeemGiftCard";

const gift = {
  id: "g1", name: "咖啡券", points_cost: 200, stock_remaining: 5,
  gift_type: "voucher", status: "available",
} as never;

describe("RedeemGiftCard", () => {
  it("disables redeem when the balance is insufficient", () => {
    render(<RedeemGiftCard gift={gift} balance={100} />);
    expect(screen.getByRole("button", { name: "積分不足" })).toBeDisabled();
  });

  it("reveals the issued code after a successful redeem", () => {
    mutate.mockImplementation((_id: string, opts: { onSuccess: (r: { code: string }) => void }) =>
      opts.onSuccess({ code: "CODE-XYZ" }),
    );
    render(<RedeemGiftCard gift={gift} balance={500} />);
    fireEvent.click(screen.getByRole("button", { name: "兌換" }));
    fireEvent.click(screen.getByRole("button", { name: "確認" }));
    expect(screen.getByText("CODE-XYZ")).toBeInTheDocument();
  });
});
