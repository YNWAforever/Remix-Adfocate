import { createFileRoute, useParams } from "@tanstack/react-router";
import { ContentEditor } from "@/components/admin/ContentEditor";

export const Route = createFileRoute("/admin/content/$id")({ component: EditorPage });

function EditorPage() {
  const { id } = useParams({ from: "/admin/content/$id" });
  return <ContentEditor id={id} />;
}
