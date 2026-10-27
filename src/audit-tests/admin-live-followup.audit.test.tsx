import React from 'react';
import {describe,it,expect,vi,beforeEach} from 'vitest';
import {render,screen,cleanup,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';

const h=vi.hoisted(()=>({missions:vi.fn(),submissions:vi.fn(),approve:vi.fn()}));
vi.mock('@/components/admin/AdminAuthContext',()=>({useAdminAuth:()=>({authed:true,reportAuthError:vi.fn()})}));
vi.mock('@/components/admin/AdminWorkspaceContext',()=>({useAdminWorkspace:()=>({workspace:'audit-workspace'})}));
vi.mock('@/lib/admin',()=>({
 fetchAdminMissions:h.missions,fetchSubmissions:h.submissions,approveSubmission:h.approve,
 rejectSubmission:vi.fn(),closeMission:vi.fn(),deleteMissionDraft:vi.fn(),duplicateMission:vi.fn(),publishMission:vi.fn(),
 adminMissionKeys:{list:(ws:string,status:string)=>['audit-missions',ws,status]},
 adminKeys:{submissions:(status:string,ws:string)=>['audit-submissions',ws,status]},
 AdminAuthError:class extends Error{},AdminRequestError:class extends Error{},
}));
vi.mock('@/lib/i18n',()=>({useI18n:()=>({t:(k:string)=>k,lang:'en'})}));
vi.mock('@tanstack/react-router',()=>({
 createFileRoute:()=> (x:unknown)=>({options:x}),useNavigate:()=>vi.fn(),
 Link:({children,to}:{children:React.ReactNode,to:string})=><a href={to}>{children}</a>,
}));
import {Route as MissionsRoute} from '../routes/admin.missions.index';
import {Route as SubmissionsRoute} from '../routes/admin.submissions';

function show(component:unknown){
 const qc=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 const C=component as React.ComponentType;
 render(<QueryClientProvider client={qc}><C/></QueryClientProvider>);
 return qc;
}

describe('2026-10-22 staff live follow-up acceptance',()=>{
 beforeEach(()=>{cleanup();vi.clearAllMocks()});
 it('UC-A53: mission load failure must show an actionable error, not an unexplained blank list',async()=>{
  h.missions.mockRejectedValue(new Error('schema unavailable'));
  const qc=show(MissionsRoute.options.component);
  await waitFor(()=>expect(qc.getQueryCache().getAll()[0]?.state.status).toBe('error'));
  expect(screen.queryByRole('alert')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/retry|reload|重試|重新載入/i})).toBeInTheDocument();
 });
 it('UC-A54: invalid legacy evidence must not enable ordinary approval',async()=>{
  h.submissions.mockResolvedValue({submissions:[{
   id:'synthetic-submission',content_urls:['wwww'],
   creators:{display_name:'Audit Creator'},missions:{title:'Audit Mission'},
  }]});
  show(SubmissionsRoute.options.component);
  await screen.findByText('Audit Creator');
  expect(screen.getByRole('button',{name:'app.admin.submissionsApprove'})).toBeDisabled();
  expect(screen.queryByRole('link',{name:'wwww'})).not.toBeInTheDocument();
  expect(h.approve).not.toHaveBeenCalled();
 });
});
