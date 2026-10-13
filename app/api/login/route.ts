import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import bcrypt from "bcrypt";

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;

interface RateLimitEntry {
  count: number;
  firstAttemptAt: number;
}

const attemptsByKey = new Map<string, RateLimitEntry>();

function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();
  return "unknown";
}

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attemptsByKey.get(key);

  if (!entry || now - entry.firstAttemptAt > RATE_LIMIT_WINDOW_MS) {
    attemptsByKey.set(key, { count: 1, firstAttemptAt: now });
    return false;
  }

  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX_ATTEMPTS) {
    return true;
  }

  return false;
}

export async function POST(request: Request) {
  const supabase = getSupabase();
  if (!supabase) return NextResponse.json({ error: "Not configured" }, { status: 503 });

  const { email, password } = await request.json();

  const rateLimitKey = `${getClientIp(request)}:${email}`;
  if (isRateLimited(rateLimitKey)) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }

  const { data, error } = await supabase
    .from("customers")
    .select("id, email, full_name, password_hash")
    .eq("email", email)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "No such account" }, { status: 401 });
  }

  const passwordMatches = data.password_hash && (await bcrypt.compare(password, data.password_hash));
  if (!passwordMatches) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const { password_hash, ...user } = data;
  return NextResponse.json({ user });
}
