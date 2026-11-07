import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {expect,it,vi} from 'vitest';
import {PilotPrivatePanel} from './PilotPrivatePanel';
it('requires separate unchecked consent for mock authorization and never exposes a provider redirect',async()=>{
 const act=vi.fn(async(action:string)=>action==='begin'?{state:'local-state',scopes:['instagram_basic'],sampleOnly:true}:{});const api={read:async()=>({connection:{status:'not_connected',sampleOnly:true,generation:0},collection:{sampleOnly:true,threadId:'thread',briefs:[],sources:[],draft:null,receiptId:null,submissionId:'submission',approvedVersionId:'version'}}),act};
 render(<PilotPrivatePanel api={api}/>);await screen.findByRole('button',{name:'開始模擬授權'});fireEvent.click(screen.getByRole('button',{name:'開始模擬授權'}));await screen.findByRole('button',{name:'確認模擬授權'});expect(screen.getByRole('button',{name:'確認模擬授權'})).toBeDisabled();expect(screen.queryByRole('link',{name:/Facebook|Instagram/})).not.toBeInTheDocument();fireEvent.click(screen.getByRole('checkbox',{name:'我已核對模擬帳號與權限。'}));fireEvent.click(screen.getByRole('button',{name:'確認模擬授權'}));await waitFor(()=>expect(act).toHaveBeenCalledWith('complete',expect.objectContaining({state:'local-state'})));
});
