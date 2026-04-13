import { z } from "zod";

export const realtimeJwtPayload = z.object({
  jti: z.string().min(1),
  sub: z.string().min(1),
  nid: z.string().min(1),
  vid: z.string().min(1),
  role: z.enum(["OWNER", "ADMIN", "MEMBER"]),
  exp: z.number().int().positive(),
});

export type RealtimeJwtPayload = z.infer<typeof realtimeJwtPayload>;
