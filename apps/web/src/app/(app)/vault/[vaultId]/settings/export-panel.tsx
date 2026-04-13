"use client";

import { useCallback, useEffect, useState } from "react";

type Status = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

interface JobState {
  id: string;
  status: Status;
  downloadUrl: string | null;
  errorMessage: string | null;
}

export function ExportPanel({ vaultId }: { vaultId: string }) {
  const [job, setJob] = useState<JobState | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const startExport = useCallback(async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/exports/${vaultId}`, { method: "POST" });
      if (!res.ok) throw new Error(`failed: ${res.status}`);
      const body = (await res.json()) as { jobId: string };
      setJob({ id: body.jobId, status: "PENDING", downloadUrl: null, errorMessage: null });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [vaultId]);

  useEffect(() => {
    if (!job) return;
    if (job.status === "COMPLETED" || job.status === "FAILED") return;
    const t = setInterval(async () => {
      const res = await fetch(`/api/exports/job/${job.id}`);
      if (!res.ok) return;
      const body = (await res.json()) as JobState;
      setJob(body);
    }, 2000);
    return () => clearInterval(t);
  }, [job]);

  return (
    <section>
      <h2>Export vault</h2>
      <p>
        Download a zip of every note and folder as markdown files. Wiki-links are
        preserved so the archive is re-importable.
      </p>
      <button type="button" onClick={startExport} disabled={busy}>
        {busy ? "Starting..." : "Export vault"}
      </button>
      {err ? <p role="alert">{err}</p> : null}
      {job ? (
        <div>
          <p>Status: {job.status}</p>
          {job.status === "COMPLETED" && job.downloadUrl ? (
            <a href={job.downloadUrl}>Download zip</a>
          ) : null}
          {job.status === "FAILED" ? <p>{job.errorMessage}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
