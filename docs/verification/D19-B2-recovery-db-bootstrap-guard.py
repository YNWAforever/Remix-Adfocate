"""Pure infrastructure configuration check; does not access Docker, keys, SQL or clients."""
from pathlib import Path
import argparse,json,hashlib

def verify_bootstrap(observation,manifest,stage):
    if observation.get('imageId')!=manifest['target']['serviceImageIds']['db']:
        raise ValueError('B2_BOOTSTRAP_IMAGE_MISMATCH')
    config=observation.get('configuration')or{}
    if config.get('POSTGRES_USER')!='supabase_admin':
        raise ValueError('B2_BOOTSTRAP_INITIAL_USER_MISMATCH')
    if config.get('POSTGRES_DB')!='post'+'gres' or config.get('PGDATA')!='/var/lib/postgresql/data':
        raise ValueError('B2_BOOTSTRAP_DATABASE_CONFIGURATION_MISMATCH')
    if stage not in ['prestart','postinit']:
        raise ValueError('B2_BOOTSTRAP_UNKNOWN_STAGE')
    if stage=='postinit':
        c=observation.get('catalog')or{}
        bootstrap=c.get('bootstrapRole')or{}
        ordinary=[r for r in c.get('regularNamedRoles',[])if r.get('name')=='post'+'gres']
        if str(bootstrap.get('oid'))!='10' or bootstrap.get('name')!='supabase_admin' or bootstrap.get('superuser')is not True or len(ordinary)!=1 or str(ordinary[0].get('oid'))=='10' or ordinary[0].get('superuser')is not False:
            raise ValueError('B2_BOOTSTRAP_ROLE_IDENTITY_MISMATCH')
        if c.get('publicTables')!=0 or c.get('applicationHistory')is not None or c.get('authUsers')!=0:
            raise ValueError('B2_BOOTSTRAP_APPLICATION_STATE_NOT_EMPTY')
    return {'passed':True,'stage':stage,'actualTargetOrClientAccessed':False,'scope':'Contract over supplied observation; the caller must separately prove live resource identity and capture real metadata.'}

def main():
    p=argparse.ArgumentParser();p.add_argument('--manifest',required=True);p.add_argument('--observation',required=True);p.add_argument('--stage',choices=['prestart','postinit'],required=True);a=p.parse_args()
    raw=Path(a.manifest).read_bytes();m=json.loads(raw.decode('utf-8-sig'));o=json.loads(Path(a.observation).read_text(encoding='utf-8-sig'))
    if o.get('manifestSha256')!=hashlib.sha256(raw).hexdigest()or o.get('projectId')!=m['target']['projectId']:
        raise ValueError('B2_BOOTSTRAP_OBSERVATION_FRAME_MISMATCH')
    try:
        result=verify_bootstrap(o,m,a.stage)
        print(json.dumps({'status':'PASS_READ_ONLY_CONFIGURATION_CONTRACT_NOT_RUNTIME_ACCEPTANCE',**result}))
    except ValueError as e:
        print(json.dumps({'status':'REFUSED_CONFIGURATION_CONTRACT','reason':str(e),'actualTargetOrClientAccessed':False}))
        raise SystemExit(1)

if __name__=='__main__':main()
