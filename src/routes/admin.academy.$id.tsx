import { createFileRoute, useParams } from "@tanstack/react-router";
import { AcademyEditor } from "@/components/admin/AcademyEditor";

export const Route = createFileRoute("/admin/academy/$id")({ component: EditorPage });

function EditorPage() {
  const { id } = useParams({ from: "/admin/academy/$id" });
  return <AcademyEditor id={id} />;
}
