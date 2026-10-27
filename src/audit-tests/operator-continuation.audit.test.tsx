import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const h = vi.hoisted(() => ({ review: vi.fn(), workspaces: vi.fn() }));
vi.mock('@/lib/admin', () => ({ postCreatorReview: h.review, fetchWorkspaces: h.workspaces, adminMissionKeys: {workspaces:['audit-workspaces']}, AdminAuthError: class extends Error {} }));
vi.mock('@/lib/i18n', () => ({useI18n:()=>({lang:'zh',t:(key:string)=>key})}));
vi.mock('@/components/admin/AdminAuthContext', () => ({useAdminAuth:()=>({authed:true,reportAuthError:vi.fn()})}));
vi.mock('@tanstack/react-router', () => ({Link:({children}:{children:React.ReactNode})=><a href="/admin/active-missions">{children}</a>}));
import { ReviewActionPanel } from '@/components/operator/ReviewActionPanel';
import { ActiveMissionQueue } from '@/components/admin/ActiveMissionQueue';
import { AdminWorkspaceProvider } from '@/components/admin/AdminWorkspaceContext';
import { WorkspaceSwitcher } from '@/components/admin/WorkspaceSwitcher';
import type { ActiveMissionQueueItem } from '@/lib/admin';
const creator={id:'audit-creator',displayName:'Synthetic creator',review:{status:'needs_review' as const,riskLevel:'unknown' as const,summary:null,reviewedBy:null,lastReviewedAt:null,updatedAt:null}};
function wrap(child:React.ReactNode){const qc=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});render(<QueryClientProvider client={qc}>{child}</QueryClientProvider>);return qc;}
function queue(due:string,now:string){
 const item:ActiveMissionQueueItem={workflowId:'wf',workItemId:'wi',missionId:'mission',creatorDisplayName:'Synthetic creator',missionTitle:'Audit mission',deliverableTitle:'Audit deliverable',state:'submitted',creatorDeadline:null,submittedAt:null,reviewDueAt:due,reviewerId:null,riskBucket:'due_soon'};
 render(<ActiveMissionQueue items={[item]} now={new Date(now)}/>);
}
describe('Operator continuation acceptance',()=>{
 beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();window.history.replaceState(null,'','/admin');});
 afterEach(cleanup);
 it('UC-A25: failed review must show an actionable error and retain the note',async()=>{
  h.review.mockRejectedValue(new Error('service unavailable'));
  const qc=wrap(<ReviewActionPanel creator={creator} variant="full"/>);
  fireEvent.change(screen.getByLabelText('Review note'),{target:{value:'Synthetic review rationale'}});
  fireEvent.click(screen.getByRole('button',{name:'Save review action'}));
  await waitFor(()=>expect(qc.getMutationCache().getAll()[0]?.state.status).toBe('error'));
  expect(screen.getByLabelText('Review note')).toHaveValue('Synthetic review rationale');
  expect(screen.queryByRole('alert')).toBeInTheDocument();
 });
 it('UC-A26: flag action must collect an operator reason before committing',()=>{
  h.review.mockResolvedValue({});wrap(<ReviewActionPanel creator={creator}/>);
  fireEvent.click(screen.getByRole('button',{name:'Flag Synthetic creator'}));
  expect(h.review).not.toHaveBeenCalled();
  expect(screen.queryByRole('textbox',{name:/reason|note|原因|備註/i})).toBeInTheDocument();
 });
 it('UC-A27: workspace lookup failure must be distinguishable from All workspaces',async()=>{
  h.workspaces.mockRejectedValue(new Error('network unavailable'));
  const qc=wrap(<AdminWorkspaceProvider><WorkspaceSwitcher/></AdminWorkspaceProvider>);
  await waitFor(()=>expect(qc.getQueryCache().getAll()[0]?.state.status).toBe('error'));
  expect(screen.queryByRole('alert')).toBeInTheDocument();
 });
 it('UC-A28: later today in Hong Kong remains today across UTC midnight',()=>{
  queue('2026-10-23T03:00:00Z','2026-10-22T23:30:00Z');
  expect(screen.queryByText('app.admin.activeMission.queue.dueToday')).toBeInTheDocument();
 });
 it('UC-A29: tomorrow in Hong Kong is not labelled today because UTC date matches',()=>{
  queue('2026-10-22T17:00:00Z','2026-10-22T15:30:00Z');
  expect(screen.queryByText('app.admin.activeMission.queue.dueToday')).not.toBeInTheDocument();
 });
});
