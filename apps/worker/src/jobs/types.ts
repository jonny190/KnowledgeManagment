export const EXPORT_VAULT_QUEUE = "export-vault" as const;

export interface ExportVaultPayload {
  vaultId: string;
  requestedByUserId: string;
  jobId: string;
}

export function isExportVaultPayload(v: unknown): v is ExportVaultPayload {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.vaultId === "string" &&
    typeof o.requestedByUserId === "string" &&
    typeof o.jobId === "string"
  );
}
