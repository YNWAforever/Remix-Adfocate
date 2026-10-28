"""Read-only P0 source/evidence/ledger verification; never connects to service targets."""
from pathlib import Path
import os,json,hashlib,csv
ROOT=Path(__file__).resolve().parents[2]
os.chdir(ROOT)
V=Path("docs/verification")
def read(p):return json.loads(Path(p).read_text(encoding="utf-8-sig"))
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
fp=read(V/"code-fingerprint.json")
assert len(fp["files"])==777
assert hashlib.sha256(json.dumps(fp["files"],separators=(",",":")).encode()).hexdigest()==fp["fingerprint"]
for row in fp["files"]:assert hashlib.sha256(Path(row["path"]).read_bytes().decode("utf-8").replace("\r\n","\n").encode()).hexdigest()==row["sha256"],row["path"]
m=read(V/"D19-B2-runtime-manifest.json");a=read(V/"D19-B2-runtime-authorization-template.json");d=read(V/"D19-B2-P0-delivery.json")
assert m["candidate"]["fingerprint"]==fp["fingerprint"]==d["sourceFingerprint"]==a["sourceFingerprint"]
assert m["sourceRecords"]==m["candidate"]["sourceRecords"]==777
assert sha(V/"D19-B2-runtime-manifest.json")==a["manifestSha256"]==d["runtimeManifestSha256"]
assert a["approved"] is False and m["approval"]["runtimeApproved"] is False
assert d["incidentOpen"] and d["releaseHold"] and not d["restored"] and not d["providerEnabled"] and not d["wholeR1Verified"]
assert d["actualNewTargets"]==d["actualFixtureRowsCreated"]==d["actualBrowserOrIntegrationRuns"]==0
assert len(m["fixture"]["rowScopes"])==70
caps=m["fixture"]["rowCaps"]
assert sum(caps[p]["auth_users"]for p in caps)==84
assert sum(caps[p]["workspaces"]for p in caps)==6
assert sum(caps[p]["mission_submissions"]for p in caps)==7
assert sum(caps[p]["mission_workflows"]for p in caps)==4
assert all(caps[p]["academy_lessons"]==caps[p]["mission_draft_assets"]==caps[p]["storage_objects"]==0 for p in caps)
assert m["execution"]["pristineRpcRerun"] is False
assert len(m["schemaProfile"]["fullMigrations"])==72
for row in m["schemaProfile"]["fullMigrations"]:assert sha(row["path"])==row["sha256"],row["path"]
profile=read(V/"D19-B2-bootstrap-profile.json")
assert profile["profileDigest"]==m["bootstrap"]["profileDigest"]
assert profile["legacyXp"]["ordinaryApproval"]==100 and profile["legacyXp"]["cumulative"]==135
for g in read(V/"D19-B2-P0-gates.json")["gates"]:
 assert g["exit"]==0 and g["sourceUnchangedAfter"] and g["sourceFingerprint"]==fp["fingerprint"]
 assert sha(V/g["publicLog"])==g["publicLogSha256"]
r=read(V/"D19-B2-P0-full-results.json")
assert r["numPassedTests"]==2027 and r["numFailedTests"]==0 and r["numPendingTests"]==363 and r["files"]==286
assert r["audit16Passed"]==16 and r["original194Passed"]==194 and r["newLocalTests"]==34
assert read(V/"D19-B2-P0-post-full-metadata-check.json")["passed"]==3
for name,allowed in [("audit_case_coverage.csv",{"newResult","codeStatus","testStatus","deploymentStatus","runtimeStatus","newEvidence","limitations"}),("implementation_backlog.csv",{"newResult","codeStatus","testStatus","deploymentStatus","runtimeStatus","evidence"}),("finding_traceability.csv",set())]:
 old=list(csv.DictReader((V/("D19-B2-P0-prior-"+name)).open(encoding="utf-8-sig",newline="")))
 new=list(csv.DictReader((V/name).open(encoding="utf-8-sig",newline="")))
 assert len(old)==len(new)
 for x,y in zip(old,new):assert all(x[k]==y[k]for k in x if k not in allowed),(name,x)
prior=read(V/"D19-B2-P0-prior-evidence-integrity.json")
allowed={"docs/verification/"+n for n in ["adfocate-delivery.json","code-fingerprint.json","evidence-integrity.json","implementation_backlog.csv","audit_case_coverage.csv"]}
changed=[]
for row in prior["files"]:
 if not Path(row["path"]).is_file()or sha(row["path"])!=row["sha256"]:changed.append(row["path"])
assert set(changed)<=allowed,changed
for row in read(V/"D19-B2-P0-changed-source.json")["files"]:
 assert sha(row["path"])==row["afterSha256"]
 if row["beforeCopy"]:assert sha(V/row["beforeCopy"])==row["beforeSha256"]
for name in ["D19-B2-P0-integrity.json","evidence-integrity.json"]:
 seal=read(V/name)
 assert seal["codeFingerprint"]==fp["fingerprint"]
 for row in seal["files"]:
  assert Path(row["path"]).stat().st_size==row["bytes"] and sha(row["path"])==row["sha256"],row["path"]
print(json.dumps({"status":"PASS_LOCAL_P0_RECORD_INTEGRITY_NOT_RUNTIME_ACCEPTANCE","sourceFingerprint":fp["fingerprint"],"sourceRecords":777,"priorEvidenceRecords":len(prior["files"]),"priorEvidenceUnchanged":len(prior["files"])-len(changed),"originalAuditCases":107,"originalFindings":28,"runtimeApproved":False,"incidentOpen":True,"releaseHold":True,"providerEnabled":False}))
