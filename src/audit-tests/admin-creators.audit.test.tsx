import React from 'react';
import {describe,it,expect,vi,beforeEach} from 'vitest';
import {render,screen,cleanup,waitFor,fireEvent} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
const h=vi.hoisted(()=>({fetch:vi.fn()}));
vi.mock('@/components/admin/AdminAuthContext',()=>({useAdminAuth:()=>({authed:true,reportAuthError:vi.fn()})}));
vi.mock('@/components/admin/AdminWorkspaceContext',()=>({useAdminWorkspace:()=>({workspace:'audit-workspace'})}));
vi.mock('@/lib/admin',()=>({fetchCreatorReviewQueue:h.fetch,AdminAuthError:class extends Error{}}));
vi.mock('@/components/operator/CreatorReviewRow',()=>({CreatorReviewRow:({creator}:{creator:{displayName:string}})=><p>{creator.displayName}</p>}));
vi.mock('@/lib/i18n',()=>({useI18n:()=>({t:(k:string)=>k,lang:'en'})}));
vi.mock('@tanstack/react-router',()=>({createFileRoute:()=> (x:unknown)=>({options:x,useSearch:()=>({})})}));
import {Route} from '../routes/admin.creators';
function show(){const qc=new QueryClient({defaultOptions:{queries:{retry:false}}});const C=Route.options.component as React.ComponentType;render(<QueryClientProvider client={qc}><C/></QueryClientProvider>);return qc}
describe('2026-10-22 operator queue acceptance',()=>{
 beforeEach(()=>{cleanup();vi.clearAllMocks()});
 it('UC-A04: all 26 creators are reachable from the queue',async()=>{
  h.fetch.mockImplementation(async({page}:{page:number})=>({creators:page===1?Array.from({length:25},(_,i)=>({id:String(i),displayName:`Creator ${i+1}`})):[{id:'26',displayName:'Creator 26'}],total:26,page,pageSize:25}));
  show();await screen.findByText('Creator 25');
  const next=screen.queryByRole('button',{name:/next|load more|下一|更多/i});
  expect(next,'26th creator needs a reachable pagination control').toBeInTheDocument();
  fireEvent.click(next!);await screen.findByText('Creator 26');
 });
 it('UC-A05: a list request failure must be visible and recoverable',async()=>{
  h.fetch.mockRejectedValue(new Error('network unavailable'));const qc=show();
  await waitFor(()=>expect(qc.getQueryCache().getAll()[0]?.state.status).toBe('error'));
  expect(screen.queryByRole('alert')).toBeInTheDocument();
 });
});
