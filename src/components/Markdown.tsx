import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";

/** Renders first-party markdown, sanitized. Tailwind prose-ish styling via wrapper classes. */
export function Markdown({ source }: { source: string }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed [&_h1]:text-lg [&_h1]:font-heading [&_h1]:font-bold [&_h2]:font-heading [&_h2]:font-bold [&_ul]:list-disc [&_ul]:pl-5 [&_a]:underline [&_img]:rounded-[var(--radius)]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{source}</ReactMarkdown>
    </div>
  );
}
