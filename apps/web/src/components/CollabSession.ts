"use client";

import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { HocuspocusProvider } from "@hocuspocus/provider";
import type { Awareness } from "y-protocols/awareness";
import { issueRealtimeToken } from "@/app/actions/realtime";
import { userColor } from "./userColor";

export interface CollabUser {
  id: string;
  name: string;
}

export interface CollabSession {
  doc: Y.Doc;
  ytext: Y.Text;
  awareness: Awareness;
  provider: HocuspocusProvider;
  status: "connecting" | "connected" | "disconnected" | "error";
}

export function useCollabSession(noteId: string, user: CollabUser): CollabSession | null {
  const [session, setSession] = useState<CollabSession | null>(null);
  const destroyed = useRef(false);

  useEffect(() => {
    // Skip setup when noteId is empty (collab not ready yet).
    if (!noteId) return;

    destroyed.current = false;
    let provider: HocuspocusProvider | null = null;
    let persistence: IndexeddbPersistence | null = null;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;
    const doc = new Y.Doc();

    (async () => {
      const token = await issueRealtimeToken(noteId);
      if (destroyed.current) return;

      persistence = new IndexeddbPersistence(`km-note-${noteId}`, doc);
      const url = process.env.NEXT_PUBLIC_REALTIME_URL ?? "ws://localhost:3001";
      if (!url) throw new Error("NEXT_PUBLIC_REALTIME_URL not set");

      provider = new HocuspocusProvider({
        url,
        name: noteId,
        token,
        document: doc,
      });

      provider.awareness!.setLocalStateField("user", {
        id: user.id,
        name: user.name,
        color: userColor(user.id),
      });

      const updateStatus = (status: CollabSession["status"]) => {
        if (destroyed.current) return;
        setSession((prev) =>
          prev
            ? { ...prev, status }
            : {
                doc,
                ytext: doc.getText("content"),
                awareness: provider!.awareness!,
                provider: provider!,
                status,
              },
        );
      };

      provider.on("status", (e: { status: string }) => {
        if (e.status === "connected") updateStatus("connected");
        else if (e.status === "disconnected") updateStatus("disconnected");
      });
      provider.on("authenticationFailed", () => updateStatus("error"));

      updateStatus("connecting");

      refreshTimer = setInterval(async () => {
        try {
          const fresh = await issueRealtimeToken(noteId);
          provider!.configuration.token = fresh;
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error("[collab] token refresh failed", e);
        }
      }, 4 * 60 * 1000);
    })();

    return () => {
      destroyed.current = true;
      if (refreshTimer) clearInterval(refreshTimer);
      if (provider) provider.destroy();
      if (persistence) persistence.destroy();
      doc.destroy();
    };
  }, [noteId, user.id, user.name]);

  return session;
}
