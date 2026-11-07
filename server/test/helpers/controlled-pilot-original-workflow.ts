import {pgcrypto} from "@electric-sql/pglite/contrib/pgcrypto";
import {PGlite} from "@electric-sql/pglite";
import {readFile,readdir} from "node:fs/promises";
/** Local PostgreSQL fixture. Auth/storage/vector infrastructure is inert; original mission,
 * proof and settlement function bodies are loaded unchanged from repository SQL. */
export async function openOriginalWorkflowFixture(){
 const db=await PGlite.create("memory://",{extensions:{pgcrypto}});try{await initializeOriginalWorkflow(db);return db;}catch(error){await db.close();throw error;}
}
export async function initializeOriginalWorkflow(db:PGlite,atomic=false){
 await db.exec(`create publication supabase_realtime;create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create schema extensions;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}',created_at timestamptz default now());
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.role() returns text language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role')$$;
 create function auth.jwt() returns jsonb language sql stable as $$select jsonb_build_object('role','service_role')$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text,metadata jsonb);alter table storage.objects enable row level security;
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
 create extension pgcrypto with schema extensions;
 create function public.gen_random_bytes(integer) returns bytea language sql volatile as $$select extensions.gen_random_bytes($1)$$;
 create function public.digest(bytea,text) returns bytea language sql immutable as $$select extensions.digest($1,$2)$$;
 create function public.digest(text,text) returns bytea language sql immutable as $$select extensions.digest($1,$2)$$;
 create function public.fixture_vector_distance(real[],real[]) returns double precision language sql immutable as $$select 0::double precision$$;
 create operator <=> (leftarg=real[],rightarg=real[],function=public.fixture_vector_distance);`);
 const files=(await readdir("supabase/migrations")).filter(f=>f.endsWith(".sql")).sort();
 for(const file of files){let sql=await readFile("supabase/migrations/"+file,"utf8");sql=sql.replace(/create extension if not exists (vector|pgcrypto)( with schema extensions)?;/gi,"").replace(/\bvector\(\d+\)/g,"real[]").replace(/\bvector\b/g,"real[]").replace(/create index[^;]*using (hnsw|ivfflat)[^;]+;/gi,"");if(atomic)sql=sql.replace(/^\s*(begin|commit);\s*$/gim,"");try{await db.exec(sql);}catch(error){throw new Error(file+": "+(error as Error).message);}}
}
