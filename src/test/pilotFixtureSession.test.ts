// @vitest-environment node
import {expect,it} from 'vitest';
import {createPilotFixtureSession} from './pilotFixtureSession';
it('preserves identity across reload but rotates on logout/persona change',()=>{const values=new Map<string,string>();const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};let n=0;const random=()=>String(++n).padStart(64,'0');const a=createPilotFixtureSession(storage,random);const first=a.current();expect(createPilotFixtureSession(storage,random).current()).toBe(first);a.rotate();expect(a.current()).not.toBe(first);expect(a.isCurrent(first)).toBe(false);expect(createPilotFixtureSession(storage,random).current()).toBe(a.current());});
