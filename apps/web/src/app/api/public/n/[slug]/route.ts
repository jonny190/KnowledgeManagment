import { NextResponse } from "next/server";
import { prisma } from "@km/db";
import { renderMarkdownToHtml, ogDescription } from "@/lib/publicRender";

export async function GET(_req: Request, ctx: { params: { slug: string } }) {
  const link = await prisma.noteLink.findUnique({
    where: { slug: ctx.params.slug },
    include: { note: { select: { id: true, title: true, content: true } } },
  });
  if (!link || link.revokedAt) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) {
    return NextResponse.json({ error: "Gone" }, { status: 410 });
  }
  const html = await renderMarkdownToHtml(link.note.content);
  return NextResponse.json(
    {
      note: {
        title: link.note.title,
        html,
        description: ogDescription(link.note.content),
        renderedAt: new Date().toISOString(),
      },
    },
    { status: 200 },
  );
}
