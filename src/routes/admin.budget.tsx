import { createFileRoute } from "@tanstack/react-router";
import { AdminBudgetPanel } from "@/components/admin/AdminBudgetPanel";

export const Route = createFileRoute("/admin/budget")({ component: AdminBudgetPanel });
