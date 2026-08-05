import { NextRequest, NextResponse } from "next/server";
import { verifyCpsbc } from "@/lib/cpsbcAdapter";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const searchTerm = body.searchTerm || body.lastName || body.city;
  const institution = body.institution;

  if (!searchTerm || typeof searchTerm !== "string" || !searchTerm.trim()) {
    return NextResponse.json(
      { error: "A last name or city is required." },
      { status: 400 }
    );
  }

  const result = await verifyCpsbc({
    searchTerm: searchTerm.trim(),
    institution: typeof institution === "string" ? institution : undefined,
  });

  return NextResponse.json(result);
}
