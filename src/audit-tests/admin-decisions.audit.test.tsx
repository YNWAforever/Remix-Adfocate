import React from 'react';
import {describe,it,expect,vi,beforeEach} from 'vitest';
import {render,screen,cleanup,waitFor,fireEvent} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
const h=vi.hoisted(()=>({fetch:vi.fn(),accept:vi.fn(),decline:vi.fn()}));
vi.mock('@/components/admin/AdminAuthContext',()=>({useAdminAuth:()=>({authed:true,reportAuthError:vi.fn()})}));
vi.mock('@/components/admin/AdminWorkspaceContext',()=>({useAdminWorkspace:()=>({workspace:'audit-workspace'})}));
vi.mock('@/lib/admin',()=>({fetchApplications:h.fetch,acceptApplication:h.accept,declineApplication:h.decline,adminKeys:{applications:(ws:string)=>['admin-applications',ws]},AdminAuthError:class extends Error{}}));
vi.mock('@/components/operator/OperatorBadges',()=>({ReviewBadge:()=>null,ShortlistBadge:()=>null}));
vi.mock('@/lib/i18n',()=>({useI18n:()=>({t:(k:string)=>k,lang:'en'})}));
vi.mock('@tanstack/react-router',()=>({createFileRoute:()=> (x:unknown)=>({options:x})}));
import {Route} from '../routes/admin.applications';
describe('2026-10-22 decision failure acceptance',()=>{
 beforeEach(()=>{cleanup();vi.clearAllMocks()});
 it('UC-A06: failed acceptance must show an actionable error while keeping the row',async()=>{
  h.fetch.mockResolvedValue({applications:[{id:'audit-application',creators:{display_name:'Audit Creator'},missions:{title:'Audit Mission'}}]});
  h.accept.mockRejectedValue(new Error('quota exhausted'));
  const qc=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});const C=Route.options.component as React.ComponentType;
  render(<QueryClientProvider client={qc}><C/></QueryClientProvider>);await screen.findByText('Audit Creator');
  fireEvent.click(screen.getByRole('button',{name:'app.admin.applicationsAccept'}));
  await waitFor(()=>expect(qc.getMutationCache().getAll()[0]?.state.status).toBe('error'));
  expect(screen.getByText('Audit Creator')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeInTheDocument();
 });
});
