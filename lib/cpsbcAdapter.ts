import serverlessChromium from "@sparticuz/chromium";
import { chromium as playwrightCoreChromium, type Browser } from "playwright-core";
import { resolveInstitutionConfig } from "./institutionConfig";

type CpsbcInput = {
  searchTerm?: string;
  lastName?: string;
  city?: string;
  institution?: string;
};

type CpsbcResult = {
  outcome: "possible_match" | "not_found" | "needs_review" | "error";
  nameFound?: string;
  licenceStatus?: string;
  licenceClass?: string;
  cpsoNumber?: string;
  sourceUrl?: string;
  notes?: string;
  results?: Array<{
    fullName: string;
    licenceStatus?: string;
    licenceClass?: string;
    cpsoNumber?: string;
    registrationNumber?: string;
    practiceType?: string;
    profileUrl?: string;
  }>;
};

function isServerlessRuntime() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

export async function launchBrowser(): Promise<Browser> {
  if (isServerlessRuntime()) {
    return playwrightCoreChromium.launch({
      args: serverlessChromium.args,
      executablePath: await serverlessChromium.executablePath(),
      headless: true,
    });
  }

  const { chromium } = await import("playwright");
  return chromium.launch({ headless: true });
}

export function resolveCpssoSearchUrl(searchTerm: string) {
  const trimmedTerm = searchTerm.trim();
  if (/^\d+$/.test(trimmedTerm)) {
    return `https://register.cpso.on.ca/physician-info/?cpsonum=${trimmedTerm}`;
  }

  return "https://register.cpso.on.ca/";
}

export function parseCpssoProfilePage(payload: {
  fullName?: string;
  bodyText: string;
  profileUrl: string;
}) {
  const cleanBodyText = payload.bodyText.replace(/\s+/g, " ").trim();
  const memberStatus = cleanBodyText.match(/Member Status:\s*([A-Z][A-Za-z]+)\s+as of/i)?.[1]?.trim();
  const registrationClass = cleanBodyText.match(/Current CPSO registration class:\s*([^\n]+?)\s+as of/i)?.[1]?.trim();
  const cpsoNumber = cleanBodyText.match(/CPSO#:\s*(\d+)/i)?.[1]?.trim();
  const fullName = payload.fullName?.trim() || cleanBodyText.match(/([A-Z][A-Za-zÀ-ÿ''\.-]+(?:,\s*[A-Z][A-Za-zÀ-ÿ''\.-]+)+)/)?.[1]?.trim();

  return {
    fullName: fullName || "Unknown physician",
    licenceStatus: memberStatus || undefined,
    licenceClass: registrationClass || undefined,
    cpsoNumber: cpsoNumber || undefined,
    profileUrl: payload.profileUrl,
  };
}

export function parseCpsaProfilePage(payload: {
  fullName?: string;
  bodyText: string;
  profileUrl: string;
}) {
  const cleanBodyText = payload.bodyText.replace(/\s+/g, " ").trim();
  const membershipStatus = cleanBodyText.match(/Membership Status\s+([A-Za-z]+)/i)?.[1]?.trim();
  const registrationNumber = cleanBodyText.match(/Registration Number\s+(\d+)/i)?.[1]?.trim();
  const registerClass = cleanBodyText.match(
    /(General Register|Provisional Register(?: Postgraduate Trainee)?|Specialist Register|Education Register|Courtesy Register|Visiting Register|Full Register|Restricted Register)/i
  )?.[1]?.trim();

  return {
    fullName: payload.fullName?.trim() || "Unknown physician",
    licenceStatus: membershipStatus || undefined,
    licenceClass: registerClass || undefined,
    registrationNumber: registrationNumber || undefined,
    profileUrl: payload.profileUrl,
  };
}

export async function verifyCpsbc(input: CpsbcInput): Promise<CpsbcResult> {
  const searchTerm = (input.searchTerm || input.lastName || input.city || "").trim();
  const institutionConfig = resolveInstitutionConfig(input.institution);

  if (!searchTerm) {
    const requiredHint = institutionConfig.key === "cpso" ? "A CPSO # is required." : "A last name or city is required.";
    return {
      outcome: "error",
      notes: requiredHint,
    };
  }

  const browser = await launchBrowser();
  const page = await browser.newPage();

  try {
    if (institutionConfig.key === "cpso" && /^\d+$/.test(searchTerm)) {
      await page.goto(resolveCpssoSearchUrl(searchTerm), {
        waitUntil: "domcontentloaded",
      });
      await page.waitForLoadState("networkidle").catch(() => undefined);
    } else {
      await page.goto(institutionConfig.baseUrl, {
        waitUntil: "domcontentloaded",
      });

      if (institutionConfig.key === "cpso") {
        const searchInput = page.getByRole("textbox", { name: "CPSO #:", exact: true });
        await searchInput.waitFor({ state: "visible", timeout: 15000 });
        await searchInput.click();
        await searchInput.fill(searchTerm);

        const submitButton = page.getByRole("button", { name: "SEARCH", exact: true });
        await submitButton.click();
      } else if (institutionConfig.key === "cpsa") {
        const searchInput = page.getByRole("searchbox", { name: "Last Name" });
        await searchInput.waitFor({ state: "visible", timeout: 15000 });
        await searchInput.click();
        await searchInput.fill(searchTerm);

        const submitButton = page.getByRole("button", { name: "Search" });
        await submitButton.click();
      } else {
        const searchInput = page.locator(institutionConfig.searchInputSelector).first();
        await searchInput.waitFor({ state: "visible", timeout: 15000 });
        await searchInput.fill(searchTerm);

        const submitButton = page.locator(institutionConfig.submitSelector).first();
        await submitButton.click();
      }
    }

    if (institutionConfig.key === "cpsa") {
      // The CPSA site renders results via an ASP.NET UpdatePanel AJAX postback.
      // Polling the DOM with waitForFunction right after the click races with
      // that in-flight postback and reproducibly corrupts the search (the
      // server ends up returning 0 matches for a real, existing physician).
      // Waiting for the network to settle avoids the interference.
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => undefined);
    } else {
      await page.waitForFunction(
        () => {
          const text = document.body?.innerText?.toLowerCase() || "";
          return (
            text.includes("licence status:") ||
            text.includes("practice type:") ||
            text.includes("search results") ||
            text.includes("member status") ||
            text.includes("current cpso registration class") ||
            /no results|no matches|did not match/i.test(text)
          );
        },
        undefined,
        { timeout: 60000 }
      );
    }

    const bodyText = (await page.locator("body").innerText()).trim();
    const lowerBodyText = bodyText.toLowerCase();

    const noResultsFound =
      institutionConfig.key === "cpsa"
        ? /results:\s*0\s*match|no physicians in/i.test(lowerBodyText)
        : /no results|no matches|did not match|0 results/i.test(lowerBodyText);

    if (noResultsFound) {
      return {
        outcome: "not_found",
        sourceUrl: page.url(),
        notes: `No ${institutionConfig.label} results found for ${searchTerm}.`,
      };
    }

    const resultCards =
      institutionConfig.key === "cpso"
        ? (page.url().includes("/physician-info/")
            ? [parseCpssoProfilePage({
                fullName: (await page.locator("h1").first().textContent())?.trim() || undefined,
                bodyText,
                profileUrl: page.url(),
              })]
            : await page.locator('#physicianTable tbody tr[id="physician-extra-info"]').evaluateAll((elements) =>
                elements.map((element) => {
                  const anchor = element.querySelector("a[href]") as HTMLAnchorElement | null;
                  const fullName = (anchor?.textContent || "").replace(/\s+/g, " ").trim();
                  const text = element.textContent || "";
                  const cpsaMatch = text.match(/cpso #\s*([0-9]+)/i)?.[1]?.trim() || text.match(/\b([0-9]{4,6})\b/)?.[1]?.trim();
                  const memberStatus = text.match(/(active|inactive|expired)/i)?.[1]?.trim();
                  const locationOfPractice = text.match(/([A-Za-z].{0,80}(?:Ontario|Alberta|British Columbia|Quebec|Manitoba|Saskatchewan|Nova Scotia|New Brunswick|Newfoundland|Prince Edward Island)[^\n]*)/i)?.[1]?.trim();
                  const profileHref = element.getAttribute("data-href") || anchor?.getAttribute("href") || "";
                  const profileUrl = profileHref
                    ? new URL(profileHref, window.location.href).toString()
                    : window.location.href;

                  return {
                    fullName,
                    licenceStatus: memberStatus ? memberStatus.charAt(0).toUpperCase() + memberStatus.slice(1) : undefined,
                    licenceClass: cpsaMatch ? `CPSO #${cpsaMatch}` : undefined,
                    cpsoNumber: cpsaMatch || undefined,
                    practiceType: locationOfPractice,
                    profileUrl,
                  };
                })
              ))
        : institutionConfig.key === "cpsa"
        ? await page.locator("#MainContent_physicianSearchView_gvResults tr").evaluateAll((elements) =>
            elements
              .filter((element) => !element.classList.contains("tHeader") && !element.classList.contains("resultsNav"))
              .map((element) => {
                const cells = element.querySelectorAll("td");
                const nameCell = cells[0];
                const disciplineCell = cells[2];
                const anchor = nameCell?.querySelector("a[href]") as HTMLAnchorElement | null;
                const fullName = (anchor?.textContent || "").replace(/\s+/g, " ").trim();
                const practiceType = (disciplineCell?.textContent || "").replace(/\s+/g, " ").trim() || undefined;
                const profileHref = anchor?.getAttribute("href") || "";
                const profileUrl = profileHref
                  ? new URL(profileHref, window.location.href).toString()
                  : window.location.href;

                return {
                  fullName,
                  licenceStatus: undefined as string | undefined,
                  licenceClass: undefined as string | undefined,
                  cpsoNumber: undefined,
                  practiceType,
                  profileUrl,
                };
              })
          )
        : await page.locator(institutionConfig.resultSelector).evaluateAll((elements) =>
            elements.map((element) => {
              const anchor = element.querySelector("h5 a, a[href]") as HTMLAnchorElement | null;
              const fullName = (
                anchor?.textContent?.replace(/\s+/g, " ").trim() || ""
              ).replace(/arrow_forward/g, "").trim();
              const text = element.textContent || "";
              const licenceStatus = text.match(/Licence status:\s*([^\n]+)/i)?.[1]?.trim();
              const licenceClass = text.match(/Licence class:\s*([^\n]+)/i)?.[1]?.trim();
              const practiceType = text.match(/Practice type:\s*([^\n]+)/i)?.[1]?.trim();
              const profileHref = anchor?.getAttribute("href") || "";
              const profileUrl = profileHref
                ? new URL(profileHref, window.location.href).toString()
                : window.location.href;

              return {
                fullName,
                licenceStatus,
                licenceClass,
                cpsoNumber: undefined,
                practiceType,
                profileUrl,
              };
            })
          );

    const normalizedResults: CpsbcResult["results"] = resultCards.filter(
      (card) => card.fullName && card.fullName !== "Unknown physician"
    );

    // The CPSA results table doesn't expose member status / register class —
    // that only lives on each physician's profile page — so visit every
    // listed result (the site itself caps a page to ~10-11 rows) to fill
    // those fields in. Profile pages are plain navigations, not the AJAX
    // UpdatePanel postback the search form uses, so this doesn't run into
    // the interference that afflicts the search step.
    let cpsaSourceUrl: string | undefined;
    if (institutionConfig.key === "cpsa" && normalizedResults.length > 0) {
      cpsaSourceUrl = page.url();

      for (const result of normalizedResults) {
        if (!result.profileUrl) continue;

        await page.goto(result.profileUrl, { waitUntil: "domcontentloaded" });
        await page
          .waitForFunction(() => /Membership Status/i.test(document.body?.innerText || ""), { timeout: 30000 })
          .catch(() => undefined);
        const profileBodyText = (await page.locator("body").innerText()).trim();
        const enriched = parseCpsaProfilePage({
          fullName: result.fullName,
          bodyText: profileBodyText,
          profileUrl: result.profileUrl,
        });
        result.licenceStatus = enriched.licenceStatus;
        result.licenceClass = enriched.licenceClass;
        result.registrationNumber = enriched.registrationNumber;
      }

      if (normalizedResults.length === 1) {
        cpsaSourceUrl = normalizedResults[0].profileUrl || cpsaSourceUrl;
      }
    }

    const firstResult = normalizedResults[0];

    return {
      outcome:
        normalizedResults.length === 0
          ? "not_found"
          : "possible_match",
      nameFound: firstResult?.fullName || searchTerm,
      licenceStatus: firstResult?.licenceStatus,
      licenceClass: firstResult?.licenceClass,
      cpsoNumber: firstResult?.cpsoNumber,
      sourceUrl: institutionConfig.key === "cpsbc" ? institutionConfig.baseUrl : cpsaSourceUrl ?? page.url(),
      notes:
        normalizedResults.length > 1
          ? `Multiple ${institutionConfig.label} results found for ${searchTerm}. Each result is included below.`
          : `${institutionConfig.label} directory returned a result for ${searchTerm}.`,
      results: normalizedResults,
    };
  } catch (error) {
    return {
      outcome: "error",
      notes: error instanceof Error ? error.message : "Unknown error",
    };
  } finally {
    await browser.close();
  }
}
