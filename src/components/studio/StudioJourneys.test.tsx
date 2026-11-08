import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StudioTable } from "./StudioTable";
import { PointsBalanceCard } from "../PointsBalanceCard";
import { RedeemGiftCard } from "../RedeemGiftCard";

const mutate = vi.hoisted(() => vi.fn());
vi.mock("@/lib/i18n", () => ({ useI18n: () => ({lang:"en",t:(key:string)=>key}) }));
vi.mock("@/lib/queries/kocmax", () => ({useRedeemGift:()=>({mutate,acknowledge:vi.fn(),isPending:false,error:null,isError:false})}));

describe("remaining studio journeys", () => {
  beforeEach(() => mutate.mockReset());
  it("distinguishes an unavailable balance from a verified zero", () => {
    const {rerender} = render(<PointsBalanceCard balance={undefined}/>);
    expect(screen.getByText("Unavailable")).toBeVisible();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    rerender(<PointsBalanceCard balance={0}/>);
    expect(screen.getByText("0")).toBeVisible();
  });
  it("cannot start redemption while the balance is unknown", () => {
    render(<RedeemGiftCard gift={{id:"gift",name:"Coffee",points_cost:100,stock_remaining:1,gift_type:"code",status:"active"}}/>);
    expect(screen.getByRole("button",{name:"Balance unavailable"})).toBeDisabled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });
  it("retains a single action and every column in responsive rows", () => {
    const edit=vi.fn();
    render(<StudioTable><thead><tr><th>Title</th><th>Status</th><th>Actions</th></tr></thead><tbody><tr><td>First story</td><td>Draft</td><td><button onClick={edit}>Edit</button></td></tr></tbody></StudioTable>);
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    expect(screen.getAllByRole("cell")).toHaveLength(3);
    expect(screen.getAllByRole("button",{name:"Edit"})).toHaveLength(1);
    fireEvent.click(screen.getByRole("button",{name:"Edit"}));
    expect(edit).toHaveBeenCalledOnce();
    expect(screen.getByText("First story")).toBeVisible();
  });
  it("blocks confirmation if balance becomes unavailable while the dialog is open", () => {
    const gift = {id:"gift",name:"Coffee",points_cost:100,stock_remaining:1,gift_type:"code",status:"active"};
    const {rerender} = render(<RedeemGiftCard gift={gift} balance={200}/>);
    fireEvent.click(screen.getByRole("button",{name:"app.redemption.redeemBtn"}));
    rerender(<RedeemGiftCard gift={gift}/>);
    expect(screen.getByRole("button",{name:"app.redemption.confirm"})).toBeDisabled();
    fireEvent.click(screen.getByRole("button",{name:"app.redemption.confirm"}));
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Balance unavailable");
  });
  it("moves keyboard focus into the success state after redemption", () => {
    render(<RedeemGiftCard balance={200} gift={{id:"gift",name:"Coffee",points_cost:100,stock_remaining:1,gift_type:"code",status:"active"}}/>);
    fireEvent.click(screen.getByRole("button",{name:"app.redemption.redeemBtn"}));
    const confirm=screen.getByRole("button",{name:"app.redemption.confirm"});confirm.focus();fireEvent.click(confirm);
    act(()=>mutate.mock.calls[0][1].onSuccess({code:"EXAMPLE"}));
    const dialog=screen.getByRole("dialog");expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog,{key:"Tab"});
    expect(screen.getByRole("button",{name:"app.redemption.copyCode"})).toHaveFocus();
  });
  it("keeps redemption keyboard focus in the dialog and restores the trigger on Escape", () => {
    render(<RedeemGiftCard balance={200} gift={{id:"gift",name:"Coffee",points_cost:100,stock_remaining:1,gift_type:"code",status:"active"}}/>);
    const trigger=screen.getByRole("button",{name:"app.redemption.redeemBtn"});
    trigger.focus();fireEvent.click(trigger);
    const dialog=screen.getByRole("dialog");expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog,{key:"Tab",shiftKey:true});
    expect(screen.getByRole("button",{name:"app.redemption.confirm"})).toHaveFocus();
    fireEvent.keyDown(dialog,{key:"Escape"});
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();expect(trigger).toHaveFocus();
  });
});
