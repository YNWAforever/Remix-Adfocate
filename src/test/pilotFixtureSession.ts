/** Local rehearsal identity only, never a credential or real authentication proof. */
export function createPilotFixtureSession(storage:Pick<Storage,'getItem'|'setItem'>,random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')){
 const key='kocmax-pilot-fixture-session';
 const current=()=>{const saved=storage.getItem(key);if(saved&&/^[a-f0-9]{64}$/.test(saved))return saved;return rotate();};
 const rotate=()=>{const next=random();if(!/^[a-f0-9]{64}$/.test(next))throw new Error('INVALID_FIXTURE_SESSION');storage.setItem(key,next);return next;};
 return {current,rotate,isCurrent:(captured:string)=>current()===captured};
}
