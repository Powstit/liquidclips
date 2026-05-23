import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  // Placeholder: redirect to a real CDN URL when we have one.
  // For v1.0, send the user to the public marketing site so they can grab a clip
  // from there. Replace with a CDN-hosted MP4 in v1.1.
  return NextResponse.redirect(
    `${process.env.NEXT_PUBLIC_MARKETING_URL ?? "https://jnremployee.com"}/affiliate`,
    302
  );
}
