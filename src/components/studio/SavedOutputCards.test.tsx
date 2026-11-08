import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SavedOutputCards } from "./SavedOutputCards";
import type { StudioBrief } from "@/lib/studio/types";
vi.mock("@/lib/i18n",()=>({useI18n:()=>({lang:"zh"})}));
const old: StudioBrief={id:"old",thread_id:"thread",version:1,created_at:"2026-11-05T00:00:00Z",sections:[{id:"s",text:"SECRET_UNAVAILABLE",sourceIds:["missing"]}]};
const latest: StudioBrief={...old,id:"new",version:2,sections:[{id:"s2",text:"My new idea",sourceIds:[]}]};
it("renders private versions, latest by maximum version, and safe read-only preview",()=>{
  const onCopy=vi.fn();render(<SavedOutputCards threadId="thread" briefs={[old,latest]} sources={[]} onCopy={onCopy}/>);
  expect(screen.getByText("最新版本")).toBeInTheDocument();expect(screen.getAllByText("私人")).toHaveLength(2);
  expect(document.body).not.toHaveTextContent("SECRET_UNAVAILABLE");
  expect(screen.getByRole("button",{name:"複製 Brief v1 成新草稿"})).toBeDisabled();
  fireEvent.click(screen.getByText("預覽 Brief v2"));expect(onCopy).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"複製 Brief v2 成新草稿"}));expect(onCopy).toHaveBeenCalledWith("new");
});
it("explains command blocking and handles empty history",()=>{
  const view=render(<SavedOutputCards threadId="thread" briefs={[latest]} sources={[]} disabledReason="請先確認結果" onCopy={vi.fn()}/>);
  expect(screen.getByRole("button")).toBeDisabled();expect(screen.getByText("請先確認結果")).toBeVisible();
  view.rerender(<SavedOutputCards threadId="thread" briefs={[]} sources={[]} onCopy={vi.fn()}/>);
  expect(screen.getByText("保存後會在這裡找到成果。")).toBeVisible();
});
