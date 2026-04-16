interface Props {
  shareCount: number;
  hasActiveLink: boolean;
}

export function NoteShareBadge({ shareCount, hasActiveLink }: Props) {
  if (shareCount === 0 && !hasActiveLink) return null;
  return <span aria-label="shared" title="Shared">Shared</span>;
}
