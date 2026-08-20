import { NextRequest, NextResponse } from "next/server";
import { ACTION_TIMEOUT_MS, RESULTS_SETTLE_TIMEOUT_MS, createBrowserPage, releaseBrowser } from "@/lib/cpsbcAdapter";

export const runtime = "nodejs";
export const maxDuration = 60;

function toSafePdfFilename(value: unknown) {
  const name = typeof value === "string" && value.trim() ? value.trim() : "cpsbc-result";
  const safeName = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return `${safeName || "cpsbc-result"}.pdf`;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const searchTerm = typeof body.searchTerm === "string" ? body.searchTerm.trim() : "";
  const firstName = typeof body.firstName === "string" ? body.firstName.trim() : "";
  const fullName = typeof body.fullName === "string" ? body.fullName.trim() : "";

  if (!searchTerm) {
    return NextResponse.json(
      { error: "A CPSBC last name is required to download the PDF." },
      { status: 400 }
    );
  }

  const { browser, context, page } = await createBrowserPage({ acceptDownloads: true });

  try {
    await page.goto("https://www.cpsbc.ca/directory", { waitUntil: "domcontentloaded" });

    const searchInput = page.getByRole("textbox", { name: "Licensee Last Name" });
    await searchInput.waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
    await searchInput.click();
    await searchInput.fill(searchTerm);
    await searchInput.press("Enter");
    await page.waitForLoadState("networkidle", { timeout: RESULTS_SETTLE_TIMEOUT_MS }).catch(() => undefined);

    if (firstName) {
      const firstNameInput = page.getByRole("textbox", { name: "Licensee First Name" });
      await firstNameInput.waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
      await firstNameInput.click();
      await firstNameInput.fill(firstName);
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await page.waitForLoadState("networkidle", { timeout: RESULTS_SETTLE_TIMEOUT_MS }).catch(() => undefined);
    }

    const escapedFullName = fullName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const resultLink = fullName
      ? page
          .getByRole("link", { name: fullName, exact: true })
          .or(page.getByRole("link", { name: new RegExp(escapedFullName, "i") }))
          .first()
      : page.locator("h5 a, a[href]").first();

    await resultLink.waitFor({ state: "visible", timeout: ACTION_TIMEOUT_MS });
    await resultLink.click();
    await page.waitForLoadState("networkidle", { timeout: RESULTS_SETTLE_TIMEOUT_MS }).catch(() => undefined);

    const downloadPromise = page.waitForEvent("download", { timeout: ACTION_TIMEOUT_MS });
    await page.getByRole("link", { name: /save results as pdf/i }).click();

    const download = await downloadPromise;
    const stream = await download.createReadStream();

    if (!stream) {
      throw new Error("CPSBC did not return a readable PDF download.");
    }

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return new NextResponse(Buffer.concat(chunks), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${toSafePdfFilename(body.fullName)}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("CPSBC PDF download failed", error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to download CPSBC PDF.",
      },
      { status: 500 }
    );
  } finally {
    await releaseBrowser(browser, page, context);
  }
}
