export async function signOutAllSessions(_userId: string): Promise<void> {
  // JWT strategy: nothing to invalidate server-side today.
  // Hook for future DB-session support.
  return;
}
