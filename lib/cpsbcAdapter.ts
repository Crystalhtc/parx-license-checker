import serverlessChromium from "@sparticuz/chromium";
import { chromium as playwrightCoreChromium, type Browser, type Page } from "playwright-core";
import { resolveInstitutionConfig } from "./institutionConfig";

type CpsbcInput = {
  searchTerm?: string;
  firstName?: string;
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

type RegistryResult = NonNullable<CpsbcResult["results"]>[number];

const MAX_RESULT_PAGES = 25;

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

async function parseCurrentResultsPage(
  page: Page,
  institutionConfig: ReturnType<typeof resolveInstitutionConfig>,
  bodyText: string
): Promise<RegistryResult[]> {
  if (institutionConfig.key === "cpso") {
    if (page.url().includes("/physician-info/")) {
      return [
        parseCpssoProfilePage({
          fullName: (await page.locator("h1").first().textContent())?.trim() || undefined,
          bodyText,
          profileUrl: page.url(),
        }),
      ];
    }

    return page.locator('#physicianTable tbody tr[id="physician-extra-info"]').evaluateAll((elements) =>
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
    );
  }

  if (institutionConfig.key === "cpsa") {
    return page.locator("#MainContent_physicianSearchView_gvResults tr").evaluateAll((elements) =>
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
    );
  }

  return page.locator(institutionConfig.resultSelector).evaluateAll((elements) =>
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
}

function resultKey(result: RegistryResult) {
  return [
    result.profileUrl,
    result.cpsoNumber,
    result.registrationNumber,
    result.fullName,
    result.licenceStatus,
    result.licenceClass,
  ]
    .filter(Boolean)
    .join("|")
    .toLowerCase();
}

function normalizeNamePart(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function registryNameMatches(result: RegistryResult, firstName: string, lastName: string) {
  const normalizedFullName = normalizeNamePart(result.fullName);
  const normalizedFirstName = normalizeNamePart(firstName);
  const normalizedLastName = normalizeNamePart(lastName);

  if (!normalizedFirstName || !normalizedLastName) return true;

  const [rawLastName = "", rawGivenNames = ""] = result.fullName.split(",");
  const resultLastName = normalizeNamePart(rawLastName);
  const resultGivenNames = normalizeNamePart(rawGivenNames);

  if (resultLastName && resultGivenNames) {
    return resultLastName.includes(normalizedLastName) && resultGivenNames.includes(normalizedFirstName);
  }

  return normalizedFullName.includes(normalizedLastName) && normalizedFullName.includes(normalizedFirstName);
}

async function clickFirstEnabled(locator: ReturnType<Page["locator"]>) {
  const count = Math.min(await locator.count(), 20);

  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    const isVisible = await candidate.isVisible().catch(() => false);
    if (!isVisible) continue;

    const isDisabled = await candidate
      .evaluate((element) => {
        const button = element as HTMLButtonElement;
        const ariaDisabled = element.getAttribute("aria-disabled") === "true";
        const disabledAttribute = element.hasAttribute("disabled") || button.disabled;
        const disabledClass = element.classList.contains("disabled") || Boolean(element.closest(".disabled"));
        return ariaDisabled || disabledAttribute || disabledClass;
      })
      .catch(() => true);

    if (isDisabled) continue;

    await candidate.click();
    return true;
  }

  return false;
}

async function clickNextCpsaPage(page: Page) {
  const nextButtonClicked = await clickFirstEnabled(page.getByRole("button", { name: "Next" }));
  if (nextButtonClicked) return true;

  const nextPageNumber = await page
    .locator("#MainContent_physicianSearchView_gvResults tr.resultsNav")
    .first()
    .evaluate((navRow) => {
      const currentText = Array.from(navRow.querySelectorAll("span"))
        .map((element) => element.textContent?.trim() || "")
        .find((text) => /^\d+$/.test(text));

      if (!currentText) return null;
      return String(Number(currentText) + 1);
    })
    .catch(() => null);

  if (!nextPageNumber) return false;

  const nextLink = page
    .locator("#MainContent_physicianSearchView_gvResults tr.resultsNav a")
    .filter({ hasText: new RegExp(`^\\s*${nextPageNumber}\\s*$`) });

  return clickFirstEnabled(nextLink);
}

async function clickNextResultsPage(page: Page, institutionKey: string) {
  if (institutionKey === "cpsa") {
    return clickNextCpsaPage(page);
  }

  const nextSelectors =
    institutionKey === "cpsbc"
      ? [
          "li.pager__item--next a",
          ".pager__item--next a",
          'a[rel="next"]',
          'a[aria-label*="next" i]',
          'a[title*="next" i]',
          'a:has-text("Next")',
        ]
      : [
          'a[rel="next"]',
          '.pagination a:has-text("Next")',
          '.pagination button:has-text("Next")',
          'a[aria-label*="next" i]',
          'button[aria-label*="next" i]',
          'a:has-text("Next")',
          'button:has-text("Next")',
        ];

  for (const selector of nextSelectors) {
    const clicked = await clickFirstEnabled(page.locator(selector));
    if (clicked) return true;
  }

  return false;
}

function normalizePageText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

async function waitForResultsPage(page: Page, institutionKey: string, previousResultsText?: string) {
  if (institutionKey === "cpsa") {
    if (previousResultsText) {
      await page
        .waitForFunction(
          (previousText) => {
            const tableText = document.querySelector("#MainContent_physicianSearchView_gvResults")?.textContent || "";
            return tableText.replace(/\s+/g, " ").trim() !== previousText;
          },
          previousResultsText,
          { timeout: 20000 }
        )
        .catch(() => undefined);
    }

    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => undefined);
    return;
  }

  await page.waitForLoadState("domcontentloaded", { timeout: 20000 }).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => undefined);
}

async function collectPaginatedResults(
  page: Page,
  institutionConfig: ReturnType<typeof resolveInstitutionConfig>,
  initialBodyText: string
) {
  const results: RegistryResult[] = [];
  const seenResultKeys = new Set<string>();
  const seenPageSignatures = new Set<string>();
  let bodyText = initialBodyText;
  let pagesSearched = 0;

  for (let pageIndex = 0; pageIndex < MAX_RESULT_PAGES; pageIndex += 1) {
    const currentResults = await parseCurrentResultsPage(page, institutionConfig, bodyText);
    const pageSignature = `${page.url()}::${currentResults.map(resultKey).join("::")}`;
    if (seenPageSignatures.has(pageSignature)) break;
    seenPageSignatures.add(pageSignature);
    pagesSearched += 1;

    for (const result of currentResults) {
      const key = resultKey(result);
      if (!result.fullName || result.fullName === "Unknown physician" || seenResultKeys.has(key)) continue;
      seenResultKeys.add(key);
      results.push(result);
    }

    if (institutionConfig.key === "cpso" && page.url().includes("/physician-info/")) break;

    const previousResultsText =
      institutionConfig.key === "cpsa"
        ? await page
            .locator("#MainContent_physicianSearchView_gvResults")
            .evaluate((element) => element.textContent || "")
            .then(normalizePageText)
            .catch(() => undefined)
        : undefined;
    const advanced = await clickNextResultsPage(page, institutionConfig.key);
    if (!advanced) break;

    await waitForResultsPage(page, institutionConfig.key, previousResultsText);
    bodyText = (await page.locator("body").innerText()).trim();
  }

  return {
    results,
    pagesSearched,
    reachedPageLimit: pagesSearched === MAX_RESULT_PAGES,
  };
}

export async function verifyCpsbc(input: CpsbcInput): Promise<CpsbcResult> {
  const searchTerm = (input.searchTerm || input.lastName || input.city || "").trim();
  const firstName = (input.firstName || "").trim();
  const institutionConfig = resolveInstitutionConfig(input.institution);
  const canSearchByFirstName = institutionConfig.key === "cpsbc" || institutionConfig.key === "cpsa";
  const searchLabel = firstName && canSearchByFirstName ? `${firstName} ${searchTerm}` : searchTerm;

  if (!searchTerm) {
    const requiredHint = institutionConfig.key === "cpso" ? "A CPSO # is required." : "A last name is required.";
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
        const lastNameInput = page.getByRole("searchbox", { name: "Last Name" });
        await lastNameInput.waitFor({ state: "visible", timeout: 15000 });
        await lastNameInput.click();
        await lastNameInput.fill(searchTerm);

        if (firstName) {
          const firstNameInput = page.getByRole("searchbox", { name: "First Name" });
          await firstNameInput.waitFor({ state: "visible", timeout: 15000 });
          await firstNameInput.click();
          await firstNameInput.fill(firstName);
        }

        const submitButton = page.getByRole("button", { name: "Search" });
        await submitButton.click();
      } else {
        const lastNameInput = page.getByRole("textbox", { name: "Licensee Last Name" });
        await lastNameInput.waitFor({ state: "visible", timeout: 15000 });
        await lastNameInput.click();
        await lastNameInput.fill(searchTerm);

        const submitButton = page.locator(institutionConfig.submitSelector).first();
        await submitButton.click();

        if (firstName) {
          await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => undefined);

          const firstNameInput = page.getByRole("textbox", { name: "Licensee First Name" });
          await firstNameInput.waitFor({ state: "visible", timeout: 15000 });
          await firstNameInput.click();
          await firstNameInput.fill(firstName);

          const refinedSubmitButton = page.getByRole("button", { name: "Search", exact: true });
          await refinedSubmitButton.click();
        }
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
        notes: `No ${institutionConfig.label} results found for ${searchLabel}.`,
      };
    }

    const firstResultsUrl = page.url();
    const collectedResults = await collectPaginatedResults(page, institutionConfig, bodyText);
    let normalizedResults = collectedResults.results;
    const { pagesSearched, reachedPageLimit } = collectedResults;

    if (canSearchByFirstName && firstName) {
      normalizedResults = normalizedResults.filter((result) => registryNameMatches(result, firstName, searchTerm));
    }

    // The CPSA results table doesn't expose member status / register class —
    // that only lives on each physician's profile page — so visit every
    // listed result (the site itself caps a page to ~10-11 rows) to fill
    // those fields in. Profile pages are plain navigations, not the AJAX
    // UpdatePanel postback the search form uses, so this doesn't run into
    // the interference that afflicts the search step.
    let cpsaSourceUrl: string | undefined;
    if (institutionConfig.key === "cpsa" && normalizedResults.length > 0) {
      cpsaSourceUrl = firstResultsUrl;

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
      nameFound: firstResult?.fullName || searchLabel,
      licenceStatus: firstResult?.licenceStatus,
      licenceClass: firstResult?.licenceClass,
      cpsoNumber: firstResult?.cpsoNumber,
      sourceUrl: institutionConfig.key === "cpsbc" ? institutionConfig.baseUrl : cpsaSourceUrl ?? page.url(),
      notes:
        normalizedResults.length === 0
          ? `No ${institutionConfig.label} results found for ${searchLabel}.`
          : normalizedResults.length > 1
          ? `Multiple ${institutionConfig.label} results found for ${searchLabel}. Pulled results from ${pagesSearched} page${pagesSearched === 1 ? "" : "s"}${reachedPageLimit ? `, stopping at the ${MAX_RESULT_PAGES}-page safety limit` : ""}.`
          : `${institutionConfig.label} directory returned a result for ${searchLabel}.`,
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
