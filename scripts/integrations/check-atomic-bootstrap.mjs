// Exercises the reviewed SQL in the caller's disposable in-process database.
export async function checkAtomicBootstrap(db, workspaceA, workspaceB) {
  const checks = [];
  const creator = "b2205cc1-972c-44aa-93d4-6b5d620a7501";
  const failing = "b2205cc1-972c-44aa-93d4-6b5d620a7502";
  await db.query("insert into auth.users(id) values($1),($2)", [creator, failing]);
  const call = async (who = creator, workspace = workspaceA) => (await db.query(
    "select public.bootstrap_creator_account($1,$2,'Local bootstrap',null,null) as result", [who, workspace],
  )).rows[0].result;
  const expectFailure = async (role, callback, code) => {
    await db.exec("savepoint expected_bootstrap_failure;");
    try {
      await db.exec(`set local role ${role};`);
      await callback();
      throw new Error("ATOMIC_BOOTSTRAP_UNEXPECTED_SUCCESS");
    } catch (error) {
      await db.exec("rollback to savepoint expected_bootstrap_failure;");
      if (error.code !== code) throw error;
    }
    await db.exec("reset role;");
  };
  await db.exec("set local role service_role;");
  if ((await call()).created !== true) throw new Error("ATOMIC_BOOTSTRAP_FIRST_LOGIN_FAILED");
  await db.exec("reset role;");
  await db.query("update public.point_balances set balance=41 where creator_id=$1", [creator]);
  await db.exec("set local role service_role;");
  if ((await call()).created !== false) throw new Error("ATOMIC_BOOTSTRAP_RETRY_NOT_IDEMPOTENT");
  await db.exec("reset role;");
  const balance = (await db.query("select balance from public.point_balances where creator_id=$1", [creator])).rows[0]?.balance;
  if (balance !== 41) throw new Error("ATOMIC_BOOTSTRAP_OVERWROTE_BALANCE");
  checks.push("first login and retry preserve the stored identity and existing balance");
  await expectFailure("service_role", () => call(creator, workspaceB), "PT404");
  const extra = (await db.query("select count(*)::int as n from public.point_balances where creator_id=$1 and workspace_id=$2", [creator, workspaceB])).rows[0].n;
  if (extra) throw new Error("ATOMIC_BOOTSTRAP_CROSS_WORKSPACE_BALANCE");
  checks.push("cross-workspace call rejects without an extra balance row");
  await db.query("update public.creators set status='deleted' where id=$1", [creator]);
  await expectFailure("service_role", () => call(), "PT401");
  checks.push("deleted identity cannot bootstrap again");
  for (const role of ["anon", "authenticated"]) {
    await expectFailure(role, () => call(failing), "42501");
  }
  checks.push("anon and authenticated cannot invoke the privileged bootstrap");
  await db.exec(`
    create function private.local_bootstrap_fault() returns trigger language plpgsql as $$
      begin raise exception 'INJECTED_BOOTSTRAP_BALANCE_FAILURE'; end
    $$;
    create trigger local_bootstrap_fault before insert on public.earnings_balances
      for each row when (new.creator_id='${failing}')
      execute function private.local_bootstrap_fault();
  `);
  await expectFailure("service_role", () => call(failing), "P0001");
  const residue = (await db.query(
    "select (select count(*) from public.creators where id=$1)::int + (select count(*) from public.point_balances where creator_id=$1)::int as n",
    [failing],
  )).rows[0].n;
  if (residue) throw new Error("ATOMIC_BOOTSTRAP_PARTIAL_RESIDUE");
  checks.push("injected second-balance failure leaves no creator or first-balance row");
  await db.exec("drop trigger local_bootstrap_fault on public.earnings_balances; drop function private.local_bootstrap_fault();");
  await db.exec("set local role service_role;");
  if ((await call(failing)).created !== true) throw new Error("ATOMIC_BOOTSTRAP_RECOVERY_FAILED");
  await db.exec("reset role;");
  checks.push("same request can recover after a fully rolled-back failure");
  return checks;
}
