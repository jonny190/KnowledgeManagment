import { z } from 'zod';

export const DiagramKind = z.enum(['DRAWIO', 'BPMN']);
export type DiagramKind = z.infer<typeof DiagramKind>;

const MAX_XML_BYTES = 2 * 1024 * 1024;

export const diagramCreateSchema = z.object({
  vaultId: z.string().min(1),
  folderId: z.string().min(1).optional(),
  kind: DiagramKind,
  title: z.string().min(1).max(200),
});
export type DiagramCreateInput = z.infer<typeof diagramCreateSchema>;

export const diagramPatchSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    folderId: z.string().min(1).nullable().optional(),
    xml: z.string().max(MAX_XML_BYTES).optional(),
    expectedUpdatedAt: z.string().datetime().optional(),
  })
  .strict();
export type DiagramPatchInput = z.infer<typeof diagramPatchSchema>;

export function slugifyDiagramTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
