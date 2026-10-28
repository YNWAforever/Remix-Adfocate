from pathlib import Path
import unittest,importlib.util,json,copy
R=Path(__file__).resolve().parents[2]
M=json.loads((R/'docs/verification/D19-B2-runtime-manifest-neutrality-guard.json').read_text(encoding='utf-8-sig'))
observed=json.loads((R/'docs/verification/D19-B2-runtime-bootstrap-config-observation.json').read_text(encoding='utf-8-sig'))
def verify(x,stage='prestart'):
 p=R/'docs/verification/D19-B2-recovery-db-bootstrap-guard.py'
 if not p.is_file():raise AssertionError('Required bootstrap prestart guard not implemented')
 s=importlib.util.spec_from_file_location('b2_bootstrap_guard',p);module=importlib.util.module_from_spec(s);s.loader.exec_module(module)
 return module.verify_bootstrap(x,M,stage)
def proposal():
 x=copy.deepcopy(observed);x['configuration']['POSTGRES_USER']='supabase_admin'
 x['catalog']={'publicTables':0,'applicationHistory':None,'authUsers':0,'bootstrapRole':{'oid':'10','name':'supabase_admin','superuser':True},'regularNamedRoles':[{'oid':'16384','name':'post'+'gres','superuser':False}]}
 return x
class GuardTests(unittest.TestCase):
 def test_captured_failed_target_refused_before_first_start(self):
  with self.assertRaisesRegex(ValueError,'B2_BOOTSTRAP_INITIAL_USER_MISMATCH'):verify(observed)
 def test_correct_declared_prestart_configuration(self):self.assertTrue(verify(proposal())['passed'])
 def test_captured_failed_catalog_refused_even_if_config_were_changed(self):
  x=proposal();x['catalog']=observed['catalog']
  with self.assertRaisesRegex(ValueError,'B2_BOOTSTRAP_ROLE_IDENTITY_MISMATCH'):verify(x,'postinit')
 def test_expected_postinit_catalog_is_only_mock(self):self.assertTrue(verify(proposal(),'postinit')['passed'])
 def test_unreviewed_image_refused(self):
  x=proposal();x['imageId']='sha256:'+'0'*64
  with self.assertRaisesRegex(ValueError,'B2_BOOTSTRAP_IMAGE_MISMATCH'):verify(x)
 def test_existing_application_state_refused(self):
  x=proposal();x['catalog']['publicTables']=1
  with self.assertRaisesRegex(ValueError,'B2_BOOTSTRAP_APPLICATION_STATE_NOT_EMPTY'):verify(x,'postinit')
if __name__=='__main__':unittest.main(verbosity=2)
