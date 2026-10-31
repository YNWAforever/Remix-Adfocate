import { createFileRoute } from "@tanstack/react-router";
import { Connections } from "@/components/integrations/Connections";

export const Route = createFileRoute("/_app/connections")({ component: Connections });
