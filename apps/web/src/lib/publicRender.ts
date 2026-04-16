// Minimal server-side markdown renderer. We reuse the same pipeline as the
// in-app viewer (react-markdown + remark-gfm + rehype-highlight) but invoke it
// as a pure Node call via the underlying unified pipeline. Keeping this in a
// dedicated module lets the public page import it without pulling React
// client components into an unauthenticated server route.
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSanitize from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import rehypeStringify from "rehype-stringify";

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype)
  .use(rehypeSanitize)
  .use(rehypeHighlight)
  .use(rehypeStringify);

export async function renderMarkdownToHtml(markdown: string): Promise<string> {
  const file = await processor.process(markdown);
  return String(file);
}

export function ogDescription(markdown: string): string {
  const stripped = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~\-[\]()!]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.slice(0, 160);
}
