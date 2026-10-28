import React from 'react';
import {describe,it,expect,vi,beforeEach} from 'vitest';
import {render,screen,cleanup} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
const h=vi.hoisted(()=>({state:{data:undefined as unknown,isLoading:false,isError:false,error:null as unknown,refetch:vi.fn()}}));
vi.mock('@/lib/queries/kocmax',()=>({useMyMissions:()=>h.state}));
vi.mock('@/lib/i18n',()=>({useI18n:()=>({t:(k:string)=>k,lang:'en'})}));
vi.mock('@tanstack/react-router',()=>({createFileRoute:()=> (x:unknown)=>({options:x}),Link:({children,to}:{children:React.ReactNode,to:string})=><a href={to}>{children}</a>}));
import {Route} from '../routes/_app.my.index';
function show(){const C=Route.options.component as React.ComponentType;const client=new QueryClient({defaultOptions:{queries:{retry:false}}});return render(<QueryClientProvider client={client}><C/></QueryClientProvider>)}
describe('2026-10-22 creator regression acceptance',()=>{
 beforeEach(()=>{cleanup();h.state={data:undefined,isLoading:false,isError:false,error:null,refetch:vi.fn()}});
 it('UC-C05: a failed request must show a recoverable error, not a no-missions claim',()=>{
  h.state.isError=true;h.state.error=new Error('server unavailable');show();
  expect(screen.queryByText('app.my.empty')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeInTheDocument();
 });
 it.each(['applied','declined'])('UC-C06: %s applications remain discoverable',(status)=>{
  h.state.data=[{id:'test-sub',status,points_awarded:0,missions:{title:'Audit application',slug:'test-audit',points_reward:100}}];show();
  expect(screen.queryByText('Audit application')).toBeInTheDocument();
 });
});
