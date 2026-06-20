import { createFileRoute } from "@tanstack/react-router";
import { LegalDoc } from "@/components/legal/LegalDoc";
import { privacy } from "@/components/legal/legalContent";

export const Route = createFileRoute("/_site/legal/privacy")({ component: () => <LegalDoc doc={privacy} /> });
