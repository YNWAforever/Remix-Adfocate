import hashlib,json,re,subprocess,sys
from D19_incident_A_read import read,metadata_gate,target,ids,R,S,D,P,sqlIds
sys.stdout.reconfigure(encoding='utf-8')
visibility=read('q3-query-visibility',"""select jsonb_agg(jsonb_build_object('relation',n.nspname||'.'||c.relname,'queryRoleOwnsRelation',c.relowner=(select oid from pg_roles where rolname=current_user),'rlsEnabled',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'rowSecurityActiveForQueryRole',row_security_active(c.oid),'selectAllowed',has_table_privilege(current_user,c.oid,'SELECT'))order by c.relname)from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'and c.relname in('campaigns','campaign_missions','campaign_participants','campaign_rank_snapshots','notifications','operator_audit_events','mission_workflow_events','staff_access_audit')""")
metadata_gate();scan=json.loads((D/(P+'-q2-api-log-scan.json')).read_text());p=subprocess.Popen(scan['command'],stdout=subprocess.PIPE,stderr=subprocess.STDOUT);digest=hashlib.sha256();match=[]
for raw in p.stdout:
 digest.update(raw);line=raw.decode('utf-8',errors='replace');hit=[id for id in ids if id in line]
 if not hit:continue
 clock=re.match(r'^(\d{4}-\d\d-\d\dT\S+)',line);access=re.search(r'"(GET|POST|PATCH|DELETE|PUT|HEAD|OPTIONS) [^\r\n]*? HTTP/\d(?:\.\d)?"\s+(\d{3})\s+',line)
 keys={k:bool(re.search(r'"'+k+r'"\s*:',line))for k in ['id','status','closed_at','updated_at','workspace_id','created_at']}
 match.append({'lineSha256':hashlib.sha256(raw).hexdigest(),'timestamp':clock[1]if clock else None,'exactCampaignIds':hit,'isHttpAccessRecord':bool(access),'method':access[1]if access else None,'httpStatus':int(access[2])if access else None,'campaignRowJsonFieldNamesPresent':keys,'containsCompleteKeyedCampaignRow':all(keys.values()),'bodyOrAuthDataExported':False})
code=p.wait(timeout=15);assert code==0 and digest.hexdigest()==scan['streamSha256'],'Log retention changed; do not claim matching stream'
assert len(match)==len(scan['exactIdMatches'])
record={'reason':'Validate3 exact-ID hits are request access references, not a full pre-incident row representation','identityReverifiedBeforeRead':True,'source':P+'-q2-api-log-scan.json','sameRawStreamSha256':digest.hexdigest(),'records':match,'completeKeyedBeforeRowObserved':any(r['containsCompleteKeyedCampaignRow']for r in match),'rawLogOrUriDisplayed':False}
(D/(P+'-q2-api-log-structure.json')).write_bytes((json.dumps(record,indent=2)+'\n').encode())
rows=json.loads((D/(P+'-q3-current-rows.json')).read_text())['payload'];membership=[]
for row in rows:
 h=row['fullCurrentRowMd5'];entry={'campaignId':row['id'],'currentAfterRowMd5':h,'matchesOriginalMissingBeforeHashes':h in [x['hash']for x in json.loads((D/'D19-support-current-preservation-incident.json').read_text())['changedPriorRowHashes']]}
 for tag,file in [('postIncident','D19-support-current-postincident-shaped-rowhashes-before.private.json'),('postRecovery','D19-support-current-postrecovery-shaped-rowhashes-before.private.json')]:
  vector=json.loads((S/file).read_text(encoding='utf-8-sig'))['campaigns'];entry[tag+'VectorContainsCurrentAfterHash']=h in vector
 membership.append(entry)
(D/(P+'-q3-after-hash-corroboration.json')).write_bytes((json.dumps({'rows':membership,'meaning':'New keyed AFTER-state fingerprints match saved post-incident vectors. This does not recover the original BEFORE values or map a missing original hash to an ID; it also does not prove there were no transient intervening writes.','beforeValuesRemain':'UNKNOWN'},indent=2)+'\n').encode())
final=read('q3-final-rows',f"select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'workspaceId',c.workspace_id,'status',c.status,'closedAt',c.closed_at,'updatedAt',c.updated_at,'fullCurrentRowMd5',md5(to_jsonb(c)::text))order by c.id),'[]')from public.campaigns c where c.id in({sqlIds})")
assert final==rows,'Current end state changed during authorized reads; record conflict'
print(json.dumps({'rowSecurityActiveForAnyQueriedRelation':any(v['rowSecurityActiveForQueryRole']for v in visibility),'selectAllowedForAll':all(v['selectAllowed']for v in visibility),'apiLogMatches':len(match),'allAccessRecords':all(v['isHttpAccessRecord']for v in match),'completeBeforeRowObserved':record['completeKeyedBeforeRowObserved'],'afterHashesCorroborated':membership,'threeRowsUnchangedAcrossReadWindow':True}))
