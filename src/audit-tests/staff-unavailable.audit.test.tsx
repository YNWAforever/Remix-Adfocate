import React from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
vi.mock('@/lib/supabase',()=>({supabase:{auth:{getSession:async()=>({data:{session:{access_token:'synthetic-fixture-token'}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe:()=>{}}}}),signInWithOAuth:vi.fn(),signOut:vi.fn()}}}));
vi.mock('@/lib/i18n',()=>({useI18n:()=>({t:(key:string)=>key})}));
import {StaffAuthGate} from '@/components/admin/StaffAuthGate';
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
it('UC-A30: a staff service outage must not be presented as signed out',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('{}',{status:503})));
 render(<StaffAuthGate>{()=> <div>Authorized content</div>}</StaffAuthGate>);
 await waitFor(()=>expect(screen.queryByText('common.signingIn')).not.toBeInTheDocument());
 expect(screen.queryByRole('alert')).toBeInTheDocument();
 expect(screen.queryByText('Authorized content')).not.toBeInTheDocument();
});
