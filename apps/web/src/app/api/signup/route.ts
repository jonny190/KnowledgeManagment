import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { signupSchema } from "@km/shared";
import { signupWithCredentials } from "@/lib/signup";

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const parsed = signupSchema.parse(body);
    const { user } = await signupWithCredentials(parsed);
    return NextResponse.json({ id: user.id, email: user.email }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      return NextResponse.json({ error: "Validation failed", issues: err.issues }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = /already/i.test(message) ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
