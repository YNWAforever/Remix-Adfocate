import {render,screen,fireEvent,waitFor} from "@testing-library/react";
import {it,expect,vi} from "vitest";
import {MissionEditor} from "./MissionEditor";
import {AdminRequestError} from "@/lib/admin";
import {I18nProvider} from "@/lib/i18n";
it.each([["en","Ask the workspace owner to review your assigned role before retrying. Your input is kept."],["zh","請聯絡 workspace 負責人覆核已指派的角色，再重試。你的輸入已保留。"]] as const)("D18 announces a recoverable permission denial in %s without losing authored input",async(lang,help)=>{
 localStorage.setItem("lang",lang);const save=vi.fn().mockRejectedValue(new AdminRequestError("assigned staff capability","STAFF_CAPABILITY_REQUIRED",undefined,403));
 render(<I18nProvider><MissionEditor mode="create" workspaces={[{id:"w",name:"Owned"}]} onSave={save}/></I18nProvider>);
 await waitFor(()=>expect(document.documentElement.lang).toBe(lang==="en"?"en":"zh-Hant-HK"));
 fireEvent.change(screen.getByLabelText("標題"),{target:{value:"Unsent authored title"}});fireEvent.click(screen.getByRole("button",{name:"儲存草稿"}));
 await waitFor(()=>expect(save).toHaveBeenCalledOnce());expect(await screen.findByText(help)).toBeVisible();expect(screen.getByLabelText("標題")).toHaveValue("Unsent authored title");expect(screen.getByRole("button",{name:"儲存草稿"})).toBeEnabled();
});
