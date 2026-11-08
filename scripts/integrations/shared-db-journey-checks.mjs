// Only imported by the hardcoded in-memory rehearsal. No remote client or credentials.
export async function checkExistingJourneys(db,actors) {
 const [a,peer,b,op]=actors,workspace='b2205cc1-972c-44aa-93d4-6b5d620a7301',mission='b2205cc1-972c-44aa-93d4-6b5d620a7311';
 const passed=[];
 async function as(role,id) {
  if(!['authenticated','service_role'].includes(role))throw new Error('UNEXPECTED_TEST_ROLE');
  await db.exec(`reset role;set local role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true)",[id,role]);
 }
 async function denied(sql,params=[]) {
  await db.exec('savepoint expected_denial;');
  try {await db.query(sql,params);throw new Error('FORBIDDEN_OPERATION_ACCEPTED:'+sql);}
  catch(e) {if(e.code!=='42501')throw e;}
  finally {await db.exec('rollback to savepoint expected_denial;release savepoint expected_denial;');}
 }
 async function changed(sql,params=[],expected=1) {
  const result=await db.query(sql,params);if(result.affectedRows!==expected)throw new Error('UNEXPECTED_CHANGED_ROW_COUNT:'+sql+':'+result.affectedRows);
 }
 await as('authenticated',a);
 await changed(`update public.creators set display_name='本機回歸創作者',avatar_url=avatar_url,categories=categories,social_handles=social_handles,onboarding_step=onboarding_step,phone=phone,level_seen=level_seen where id=$1`,[a]);
 await denied("update public.creators set display_name='must not persist',xp=9999 where id=$1",[a]);
 const profile=(await db.query('select display_name,xp from public.creators where id=$1',[a])).rows[0];
 if(profile.display_name!=='本機回歸創作者'||profile.xp!==0)throw new Error('FORBIDDEN_PROFILE_UPDATE_NOT_ATOMIC');
 await changed("update public.creators set display_name='cross user rejected' where id=$1",[peer],0);
 passed.push('profile/onboarding seven permitted columns work; mixed XP update rejected atomically; other creator unchanged');

 const social=(await db.query("insert into public.creator_social_accounts(creator_id,workspace_id,platform,handle,profile_url) values($1,$2,'instagram','kocmax_d1_review_only','https://example.invalid/creator') returning id",[a,workspace])).rows[0].id;
 await changed("update public.creator_social_accounts set handle='kocmax_d1_changed',profile_url='https://example.invalid/updated' where id=$1",[social]);
 await denied('update public.creator_social_accounts set owner_verified=true where id=$1',[social]);
 await denied('update public.creator_social_accounts set workspace_id=$1 where id=$2',[workspace,social]);
 await as('authenticated',b);
 if((await db.query('select id from public.creator_social_accounts where id=$1',[social])).rows.length)throw new Error('CROSS_WORKSPACE_SOCIAL_LEAK');
 await as('authenticated',a);await changed('delete from public.creator_social_accounts where id=$1',[social]);
 passed.push('social manual handle CRUD preserved; verification/workspace writes and cross-workspace read denied; no platform contact');

 await as('service_role',op);
 const notification=(await db.query("insert into public.notifications(user_id,workspace_id,type,data) values($1,$2,'application_accepted','{\"test_only\":true}') returning id",[a,workspace])).rows[0].id;
 await as('authenticated',a);await changed('update public.notifications set read_at=now() where id=$1',[notification]);
 await denied("update public.notifications set data='{}' where id=$1",[notification]);
 await denied('delete from public.notifications where id=$1',[notification]);
 await as('authenticated',peer);await changed('update public.notifications set read_at=now() where id=$1',[notification],0);
 passed.push('service notification insertion and own acknowledgement work; content/delete/cross-user changes denied');

 await as('authenticated',op);
 await changed("update public.missions set title='本機品牌編輯',description='測試',target_audience='香港示例',updated_at=now() where id=$1",[mission]);
 await denied("update public.missions set status='published' where id=$1",[mission]);
 await denied('delete from public.missions where id=$1',[mission]);
 await as('authenticated',b);await changed("update public.missions set title='cross workspace denied' where id=$1",[mission],0);
 for(const table of ['campaigns','campaign_missions','assistant_conversations','assistant_messages']) {
  const p=(await db.query("select has_table_privilege('authenticated',$1,'INSERT') as i,has_any_column_privilege('authenticated',$1,'UPDATE') as u,has_table_privilege('authenticated',$1,'DELETE') as d",['public.'+table])).rows[0];
  if(p.i||p.u||p.d)throw new Error('BROWSER_MUTATION_REOPENED:'+table);
 }
 for(const table of ['redemption_codes','staff_users','creator_review_notes'])await denied(`select * from public.${table}`);
 passed.push('brand authoring and membership checks work; direct lifecycle/campaign/history writes and protected service reads denied');

 await as('authenticated',a);
 const portfolio=(await db.query("insert into public.creator_portfolio_links(creator_id,workspace_id,url,title,platform_type,public_highlight) values($1,$2,'https://example.invalid/work','本機作品','website',true) returning id",[a,workspace])).rows[0].id;
 await changed("update public.creator_portfolio_links set title='本機作品更新' where id=$1",[portfolio]);
 const portfolioIds=[portfolio];
 for(const label of ['second','third'])portfolioIds.push((await db.query("insert into public.creator_portfolio_links(creator_id,workspace_id,url,title,platform_type,public_highlight) values($1,$2,$3,'本機作品上限','website',true) returning id",[a,workspace,'https://example.invalid/'+label])).rows[0].id);
 await db.exec('savepoint highlight_limit;');
 try {await db.query("insert into public.creator_portfolio_links(creator_id,workspace_id,url,title,platform_type,public_highlight) values($1,$2,'https://example.invalid/fourth','不可保存的第四項','website',true)",[a,workspace]);throw new Error('HIGHLIGHT_LIMIT_REGRESSED');}
 catch(e){if(e.code!=='P0001'||!e.message.includes('highlight limit exceeded'))throw e;}
 finally{await db.exec('rollback to savepoint highlight_limit;release savepoint highlight_limit;');}
 await as('authenticated',peer);await changed("update public.creator_portfolio_links set title='cross user denied' where id=$1",[portfolio],0);
 await as('authenticated',a);
 for(const id of portfolioIds)await changed('delete from public.creator_portfolio_links where id=$1',[id]);
 await as('service_role',op);
 const servicePortfolio=(await db.query("insert into public.creator_portfolio_links(creator_id,workspace_id,url,title,platform_type,public_highlight) values($1,$2,'https://example.invalid/service-work','本機服務作品','website',true) returning id",[a,workspace])).rows[0].id;
 await changed('delete from public.creator_portfolio_links where id=$1',[servicePortfolio]);
 passed.push('authenticated/service highlighted portfolio CRUD, three-item limit and cross-user denial preserved without private schema USAGE');
 await db.exec('reset role;');
 return passed;
}
