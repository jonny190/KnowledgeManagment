import { notFound } from "next/navigation";
import { prisma } from "@km/db";
import { renderMarkdownToHtml, ogDescription } from "@/lib/publicRender";

export const dynamic = "force-dynamic";

interface Props {
  params: { slug: string };
}

export async function generateMetadata({ params }: Props) {
  const link = await prisma.noteLink.findUnique({
    where: { slug: params.slug },
    include: { note: { select: { title: true, content: true } } },
  });
  if (!link || link.revokedAt || (link.expiresAt && link.expiresAt.getTime() <= Date.now())) {
    return { title: "Not found" };
  }
  return {
    title: link.note.title,
    openGraph: {
      title: link.note.title,
      description: ogDescription(link.note.content),
    },
  };
}

export default async function PublicNotePage({ params }: Props) {
  const link = await prisma.noteLink.findUnique({
    where: { slug: params.slug },
    include: { note: { select: { title: true, content: true } } },
  });
  if (!link || link.revokedAt) notFound();
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) {
    return (
      <main className="max-w-prose mx-auto px-4 py-16">
        <h1>Link expired</h1>
        <p>This shared link is no longer available.</p>
      </main>
    );
  }
  const html = await renderMarkdownToHtml(link.note.content);
  return (
    <main className="prose max-w-prose mx-auto px-4 py-6">
      <h1>{link.note.title}</h1>
      <article dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  );
}
