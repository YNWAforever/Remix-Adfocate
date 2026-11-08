import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {acquireLocalPilotDirectory} from './localDirectoryLock.js';

/** Shared ownership boundary for runtime and offline recovery. Never a remote connection. */
export async function openLocalPilotDatabase(directory:string,options:{ignoreSystemIndexes?:boolean}={}){
 const lock=await acquireLocalPilotDirectory(directory);
 let db:PGlite;
 try{db=await PGlite.create(lock.path,{extensions:{pgcrypto},...(options.ignoreSystemIndexes?{startParams:[...PGlite.defaultStartParams,'-P']}:{})});}
 catch(error){await lock.release();throw error;}
 let closing:Promise<void>|undefined;
 const close=()=>closing??=(async()=>{await db.close();await lock.release();})();
 try{await db.exec("set statement_timeout='5s';set lock_timeout='2s';");return {db,close};}
 catch(error){await close();throw error;}
}
