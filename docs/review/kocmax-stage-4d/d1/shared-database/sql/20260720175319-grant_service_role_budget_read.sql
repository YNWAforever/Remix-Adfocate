-- Backend reward snapshots need explicit access when auto_expose_new_tables is disabled.
grant select on table
  public.workspace_budgets,
  public.workspace_budget_transactions to service_role;
