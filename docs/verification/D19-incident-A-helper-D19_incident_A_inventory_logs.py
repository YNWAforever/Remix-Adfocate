from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,os,re,subprocess,sys,tomllib
from D19_incident_A_read import metadata_gate,target,ids,R,S,D,P
sys.stdout.reconfigure(encoding='utf-8');metadata_gate();project=target['projectId']
def docker(args):
 p=subprocess.run(['docker',*args],capture_output=True,text=True,encoding='utf-8',timeout=20)
 if p.returncode:raise RuntimeError('Authorized metadata read unavailable')
 return p.stdout.strip()
# Only this project's name/label candidates; unrelated volumes are never inspected.
names=docker(['volume','ls','--filter','name='+project,'--format','{{.Name}}']).splitlines();volumes=[]
fmt='{"name":{{json .Name}},"driver":{{json .Driver}},"created":{{json .CreatedAt}},"project":{{json (index .Labels "com.supabase.cli.project")}},"scope":{{json .Scope}}}'
for name in names:
 assert project in name;v=json.loads(docker(['volume','inspect','--format',fmt,name]));v['lineageClassification']='EXACT_PROJECT_LABEL'if v['project']==project else'NAME_ONLY_UNVERIFIED_NO_CONTENT_READ';volumes.append(v)
root=(S/'r1-targets/shaped/supabase').resolve();assert root.is_dir()and root.is_relative_to(R.resolve())
config=tomllib.loads((root/'config.toml').read_text(encoding='utf-8-sig'));assert config['project_id']==project and config['api']['port']==56521 and config['db']['port']==56522
examined=0;possible=[];skipped=[]
for folder,dirs,files in os.walk(root,followlinks=False):
 for name in list(dirs):
  p=Path(folder)/name
  if p.is_symlink()or re.search(r'secret|credential|token',name,re.I):dirs.remove(name);skipped.append(p.relative_to(root).as_posix())
 for name in files:
  p=Path(folder)/name
  if p.is_symlink()or re.search(r'secret|credential|token|\.env',name,re.I):continue
  assert p.resolve().is_relative_to(root);examined+=1
  if re.search(r'backup|snapshot|\.dump$|\.sql(?:\.|$)|\.tar(?:\.|$)|\.zst$|\.gz$',name,re.I):
   stat=p.stat();possible.append({'pathRelativeToProject':p.relative_to(root).as_posix(),'bytes':stat.st_size,'mtimeUTC':datetime.fromtimestamp(stat.st_mtime,timezone.utc).isoformat(),'classification':'FILENAME_ONLY_NOT_A_TRUSTED_PREIMAGE'})
inventory={'at':datetime.now(timezone.utc).isoformat(),'projectId':project,'projectNameFilteredVolumes':volumes,'hostProjectRoot':str(root.relative_to(R)),'configProjectAndPortsMatched':True,'fileMetadataEntriesExamined':examined,'possibleBackupNamedFiles':possible,'secretSubtreesExcluded':skipped,'serverDataVolumeFilesystemInspected':False,'serverFilePermissionDenialHonoured':True,'backupConclusion':'No trusted before-image identified by accessible project inventory; server PGDATA/WAL content and external/unlabelled snapshots remain UNKNOWN. Live volumes are not point-in-time backups.','notQueried':['Unrelated volumes/projects/disks','External snapshot/PITR service without target-bound reference','Server PGDATA/WAL through any OS bypass']}
(D/(P+'-q1-project-inventory.json')).write_bytes((json.dumps(inventory,indent=2)+'\n').encode())
start='2026-10-23T19:31:12.024230Z';end='2026-10-24T07:12:04.875188Z';summaries=[]
for channel,field in [('database','databaseContainerId'),('api','apiContainerId')]:
 metadata_gate();cid=target[field];command=['docker','logs','--timestamps','--since',start,'--until',end,cid]
 p=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT);digest=hashlib.sha256();total=0;lines=0;matches=[];first=None;last=None;truncated=False
 for raw in p.stdout:
  total+=len(raw);digest.update(raw);lines+=1;line=raw.decode('utf-8',errors='replace');clock=re.match(r'^(\d{4}-\d\d-\d\dT\S+)',line)
  if clock:first=first or clock[1];last=clock[1]
  hit=[id for id in ids if id in line]
  if hit:
   candidates=bool(re.search(r'"(?:before|before_state|old_row|old_tuple)"\s*:',line))
   matches.append({'lineSha256':hashlib.sha256(raw).hexdigest(),'timestamp':clock[1]if clock else None,'exactCampaignIds':hit,'oldTupleMarkerDetected':candidates,'classification':'POTENTIAL_OLD_TUPLE_NEEDS_VALIDATION'if candidates else'REFERENCE_ONLY_NO_COMPLETE_OLD_TUPLE_EXPORTED'})
  if total>32*1024*1024:
   truncated=True;p.terminate();break
 code=p.wait(timeout=15)
 summary={'channel':channel,'containerId':cid,'windowUTC':{'from':start,'strictUpperBound':end},'command':command,'exit':code,'streamBytes':total,'lineCount':lines,'streamSha256':digest.hexdigest(),'firstReturnedLogTime':first,'lastReturnedLogTime':last,'limitTruncated':truncated,'exactIdMatches':matches,'oldTupleCandidatesDetected':sum(m['oldTupleMarkerDetected']for m in matches),'rawLogBodiesRetainedOrDisplayed':False,'privacy':'Only hashes/timestamps/exact campaign-ID hits retained; no URI, headers, note, actor, user or Auth data exported','coverage':'Only current retained Docker stdout/stderr logs in requested before-image window. Zero hits is not proof that older/rotated/external audit never existed.'}
 (D/(P+'-q2-'+channel+'-log-scan.json')).write_bytes((json.dumps(summary,indent=2)+'\n').encode());summaries.append(summary)
print(json.dumps({'projectVolumeCandidates':len(volumes),'hostProjectFileMetadataEntries':examined,'backupNamedFiles':len(possible),'serverFileBypass':False,'logScans':[{'channel':v['channel'],'exit':v['exit'],'lines':v['lineCount'],'bytes':v['streamBytes'],'exactIdMatches':len(v['exactIdMatches']),'oldTupleCandidates':v['oldTupleCandidatesDetected'],'truncated':v['limitTruncated']}for v in summaries]}))
