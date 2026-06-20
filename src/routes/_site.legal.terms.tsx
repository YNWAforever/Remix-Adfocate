import { createFileRoute } from "@tanstack/react-router";
import { LegalDoc } from "@/components/legal/LegalDoc";
import { terms } from "@/components/legal/legalContent";

export const Route = createFileRoute("/_site/legal/terms")({ component: () => <LegalDoc doc={terms} /> });
