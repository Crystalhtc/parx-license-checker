import serverlessChromium from "@sparticuz/chromium";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium as playwrightCoreChromium, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from "playwright-core";
import { resolveInstitutionConfig } from "./institutionConfig";

type CpsbcInput = {
  searchTerm?: string;
  firstName?: string;
  lastName?: string;
  licenceNumber?: string;
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
    rowIndex?: number;
  }>;
};

type RegistryResult = NonNullable<CpsbcResult["results"]>[number];

const MAX_RESULT_PAGES = 25;
const SERVERLESS_BROWSER_RECYCLE_AFTER_CHECKS = 6;
let serverlessBrowserPromise: Promise<Browser> | undefined;
let serverlessBrowserChecks = 0;

function isServerlessRuntime() {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

function userSafeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown error";
  const firstLine = message.split("\n")[0]?.trim();

  if (/Target page, context or browser has been closed|ERR_INSUFFICIENT_RESOURCES/i.test(message)) {
    return "The registry browser session closed before this check finished. Please retry, or run a smaller bulk file if this keeps happening.";
  }

  if (/Less than 64MB of free space in temporary directory/i.test(message)) {
    return "The verification server ran out of temporary browser storage while checking this registry. Please retry with a smaller batch.";
  }

  return firstLine || "Unknown error";
}

function isBrowserResourceError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /Target page, context or browser has been closed|ERR_INSUFFICIENT_RESOURCES|Less than 64MB of free space/i.test(message);
}

async function cleanupPlaywrightTempProfiles() {
  if (!isServerlessRuntime()) return;

  const temporaryDirectory = tmpdir();
  const entries = await readdir(temporaryDirectory).catch(() => []);

  await Promise.all(
    entries
      .filter((entry) => entry.startsWith("playwright_") || entry.startsWith("playwright-"))
      .map((entry) =>
        rm(join(temporaryDirectory, entry), {
          recursive: true,
          force: true,
          maxRetries: 1,
        }).catch(() => undefined)
      )
  );
}

export async function launchBrowser(): Promise<Browser> {
  if (isServerlessRuntime()) {
    if (serverlessBrowserPromise) {
      const existingBrowser = await serverlessBrowserPromise.catch(() => undefined);
      if (existingBrowser?.isConnected()) return existingBrowser;
      serverlessBrowserPromise = undefined;
    }

    serverlessBrowserPromise = (async () => {
      await cleanupPlaywrightTempProfiles();

      const browser = await playwrightCoreChromium.launch({
        args: serverlessChromium.args,
        executablePath: await serverlessChromium.executablePath(),
        headless: true,
      });

      browser.on("disconnected", () => {
        serverlessBrowserPromise = undefined;
        serverlessBrowserChecks = 0;
      });

      return browser;
    })();

    return serverlessBrowserPromise.catch((error) => {
      serverlessBrowserPromise = undefined;
      throw error;
    });
  }

  const { chromium } = await import("playwright");
  return chromium.launch({ headless: true });
}

export async function createBrowserPage(options?: BrowserContextOptions) {
  const browser = await launchBrowser();
  const context = await browser.newContext(options);
  const page = await context.newPage();

  return { browser, context, page };
}

export async function releaseBrowser(
  browser: Browser,
  page?: Page,
  context?: BrowserContext,
  options?: { forceClose?: boolean }
) {
  await page?.close().catch(() => undefined);
  await context?.close().catch(() => undefined);

  if (isServerlessRuntime()) {
    serverlessBrowserChecks += 1;

    if (options?.forceClose || serverlessBrowserChecks >= SERVERLESS_BROWSER_RECYCLE_AFTER_CHECKS) {
      serverlessBrowserPromise = undefined;
      serverlessBrowserChecks = 0;
      await browser.close().catch(() => undefined);
      await cleanupPlaywrightTempProfiles();
    }

    return;
  }

  await browser.close().catch(() => undefined);
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

function parseRegistryDate(value?: string) {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();
  const dayMonthYearMatch = trimmed.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
  const normalizedDate = dayMonthYearMatch
    ? `${dayMonthYearMatch[2]} ${dayMonthYearMatch[1]}, ${dayMonthYearMatch[3]}`
    : trimmed;
  const parsed = new Date(normalizedDate);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function normalizeCpsnsLicenceClass(value?: string) {
  return value
    ?.replace(/\s+Licence\b/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isCpsnsNonActiveListingStatus(value?: string) {
  const normalized = value?.toLowerCase() || "";
  return /removed|deceased|resigned|revoked|suspended|expired|cancelled|canceled|inactive/.test(normalized);
}

function normalizeCpspeiPracticeType(value?: string) {
  return value
    ?.replace(/\([^)]*\)/g, "")
    .replace(/\bRCPSC\s*-\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCpsnlLicenceSearch(value: string) {
  return value.replace(/^[A-Za-z]+/, "").trim();
}

async function readCpsnsFormValues(page: Page, rootSelector: string) {
  return page.locator(`${rootSelector} .form-group`).evaluateAll((elements) =>
    elements.map((element) => {
      const label = (element.querySelector("label")?.textContent || "").replace(/\s+/g, " ").replace(/:$/, "").trim();
      const input = element.querySelector("input") as HTMLInputElement | null;
      const value = (input?.value || element.querySelector(".well")?.textContent || "").replace(/\s+/g, " ").trim();
      return { label, value };
    })
  );
}

function formValuesByLabel(values: Array<{ label: string; value: string }>, label: string) {
  return values.filter((item) => item.label.toLowerCase() === label.toLowerCase()).map((item) => item.value).filter(Boolean);
}

async function parseCpsnsDetailPage(page: Page, fallback: RegistryResult): Promise<RegistryResult> {
  const summaryText = await page.locator("body").innerText();
  const registrationNumber =
    summaryText.match(/Licence No:\s*([0-9]+)/i)?.[1]?.trim() ||
    fallback.registrationNumber ||
    fallback.profileUrl?.match(/LicenceNumber=0*([0-9]+)/i)?.[1]?.trim();
  const headingName = summaryText.match(/Registrant Details\s+Dr\.\s*([^\n]+)/i)?.[1]?.trim();
  const summaryValues = await readCpsnsFormValues(page, "#A");
  const specialties = formValuesByLabel(summaryValues, "Specialty");

  await page.getByRole("link", { name: "TRAINING & LICENCE HISTORY" }).click();
  await page.waitForTimeout(500);
  const historyValues = await readCpsnsFormValues(page, "#MainContent_frmregistrationhistory");
  const historyRecords: Array<{ licenceType?: string; startDate?: string; endDate?: string }> = [];

  for (let index = 0; index < historyValues.length; index += 3) {
    const licenceType = historyValues[index]?.value;
    const startDate = historyValues[index + 1]?.value;
    const endDate = historyValues[index + 2]?.value;
    if (licenceType || startDate || endDate) {
      historyRecords.push({ licenceType, startDate, endDate });
    }
  }

  const today = startOfToday();
  const activeRecord =
    historyRecords.find((record) => {
      const endDate = parseRegistryDate(record.endDate);
      return !record.endDate || !endDate || endDate >= today;
    }) || historyRecords[0];
  const endDate = parseRegistryDate(activeRecord?.endDate);
  const isVerified = Boolean(activeRecord) && (!activeRecord.endDate || !endDate || endDate >= today);
  const licenceClass = normalizeCpsnsLicenceClass(activeRecord?.licenceType);

  return {
    ...fallback,
    fullName: headingName || fallback.fullName,
    licenceStatus: isVerified ? "Practising" : "Not verified",
    licenceClass,
    registrationNumber,
    practiceType: specialties.join(", ") || fallback.practiceType,
    profileUrl: page.url(),
  };
}

async function parseCpspeiDetailPage(page: Page, fallback: RegistryResult): Promise<RegistryResult> {
  const details = await page.locator("body").evaluate(() => {
    const textAfterLabel = (labelText: string) => {
      const label = Array.from(document.querySelectorAll("label")).find(
        (element) => (element.textContent || "").replace(/\s+/g, " ").trim().toLowerCase() === labelText.toLowerCase()
      );
      const parentText = (label?.parentElement?.textContent || "").replace(/\s+/g, " ").trim();
      return parentText.replace(new RegExp(`^${labelText}\\s*`, "i"), "").trim();
    };
    const sectionItems = (headingText: string) => {
      const heading = Array.from(document.querySelectorAll("h5")).find(
        (element) => (element.textContent || "").replace(/\s+/g, " ").trim().toLowerCase() === headingText.toLowerCase()
      );
      const section = heading?.closest(".row") || heading?.parentElement;
      return Array.from(section?.querySelectorAll("li") || [])
        .map((item) => (item.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean);
    };

    return {
      fullName: (document.querySelector("h4")?.textContent || "")
        .replace(/Atlantic registry/gi, "")
        .replace(/\s+/g, " ")
        .trim(),
      licenceType: textAfterLabel("Licence Type"),
      registrationNumber: textAfterLabel("License Number"),
      expiry: textAfterLabel("Expiry"),
      specializations: sectionItems("Specializations"),
    };
  });
  const expiryDate = parseRegistryDate(details.expiry);
  const isVerified = expiryDate ? expiryDate >= startOfToday() : false;

  return {
    ...fallback,
    fullName: details.fullName || fallback.fullName,
    licenceStatus: isVerified ? "Practising" : "Not verified",
    licenceClass: details.licenceType || fallback.licenceClass,
    registrationNumber: details.registrationNumber || fallback.registrationNumber,
    practiceType: details.specializations.map(normalizeCpspeiPracticeType).filter(Boolean).join(", ") || fallback.practiceType,
    profileUrl: page.url(),
  };
}

async function parseCpsnlDetailPage(page: Page, fallback: RegistryResult): Promise<RegistryResult> {
  const details = await page.locator("body").evaluate(() => {
    const rows = Array.from(document.querySelectorAll("table tbody tr"))
      .map((row) => Array.from(row.querySelectorAll("td")).map((cell) => (cell.textContent || "").replace(/\s+/g, " ").trim()))
      .filter((cells) => cells.length >= 4 && /^\d{1,2}-[A-Za-z]{3}-\d{4}$/.test(cells[2] || ""));
    const sectionItems = (headingText: string) => {
      const heading = Array.from(document.querySelectorAll("h5")).find(
        (element) => (element.textContent || "").replace(/\s+/g, " ").trim().toLowerCase() === headingText.toLowerCase()
      );
      const section = heading?.closest(".row") || heading?.parentElement;
      return Array.from(section?.querySelectorAll("li") || [])
        .map((item) => (item.textContent || "").replace(/\s+/g, " ").trim())
        .filter(Boolean);
    };
    const bodyText = document.body?.innerText || "";

    return {
      fullName: (document.querySelector("h4")?.textContent || "")
        .replace(/Atlantic registry/gi, "")
        .replace(/\s+/g, " ")
        .trim(),
      registrationNumber: bodyText.match(/Licence Number:\s*([A-Z0-9-]+)/i)?.[1]?.trim(),
      rows,
      specialties: sectionItems("Specialty"),
    };
  });
  const latestRecord = details.rows
    .map(([register, licenceType, effective, expiry]) => ({
      register,
      licenceType,
      effective,
      expiry,
      effectiveDate: parseRegistryDate(effective),
      expiryDate: parseRegistryDate(expiry),
    }))
    .sort((left, right) => (right.effectiveDate?.getTime() || 0) - (left.effectiveDate?.getTime() || 0))[0];
  const isVerified = latestRecord?.expiryDate ? latestRecord.expiryDate >= startOfToday() : false;

  return {
    ...fallback,
    fullName: details.fullName || fallback.fullName,
    licenceStatus: isVerified ? "Practising" : "Not verified",
    licenceClass: latestRecord?.licenceType?.replace(/\s+/g, " ").trim() || fallback.licenceClass,
    registrationNumber: details.registrationNumber || fallback.registrationNumber,
    practiceType: details.specialties.join(", ") || fallback.practiceType,
    profileUrl: page.url(),
  };
}

function textFromCell(cells: NodeListOf<HTMLTableCellElement>, index: number) {
  return (cells[index]?.textContent || "").replace(/\s+/g, " ").trim();
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
        .map((element, index) => {
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

  if (institutionConfig.key === "cpsm") {
    return page.locator(".listingCore tbody tr").evaluateAll((elements) =>
      elements
        .map((element, index) => {
          const cells = element.querySelectorAll("td");
          const cellTexts = Array.from(cells).map((cell) => (cell.textContent || "").replace(/\s+/g, " ").trim());
          const offset = /^visibility$/i.test(cellTexts[0] || "") ? 1 : 0;
          const lastName = cellTexts[offset] || "";
          const givenNames = cellTexts[offset + 1] || "";
          const suspension = cellTexts[offset + 2] || "";
          const practiceType = cellTexts[offset + 3]?.replace(/([a-z])([A-Z])/g, "$1, $2") || undefined;
          const anchor = element.querySelector("a[href]") as HTMLAnchorElement | null;
          const profileHref = anchor?.getAttribute("href") || "";
          const profileUrl = profileHref
            ? new URL(profileHref, window.location.href).toString()
            : window.location.href;

          return {
            fullName: [lastName, givenNames].filter(Boolean).join(", "),
            licenceStatus: suspension ? `Suspended effective ${suspension}` : undefined,
            licenceClass: practiceType,
            practiceType,
            profileUrl,
            rowIndex: index,
          };
        })
        .filter((result) => result.fullName.trim())
    );
  }

  if (institutionConfig.key === "cpsns") {
    return page.locator("table tr").evaluateAll((elements) => {
      const results = elements
        .map((element) => {
          const innerText = ((element as HTMLElement).innerText || element.textContent || "").trim();
          const lines = innerText.split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
          const text = lines.join(" ");
          if (!text || /^search results$/i.test(text) || /^\d+$/.test(text)) return null;

          const name = lines.find((line) => /,\s*\S/.test(line)) || text.split(" Specialty:")[0]?.trim();
          const specialty = text.match(/Specialty:\s*(.*?)(?:Phone:|Fax|Practice Location:|Zone:|Removed|$)/i)?.[1]?.trim();
          const nonActiveStatus = text.match(
            /\b((?:Removed|Deceased|Resigned|Revoked|Suspended|Expired|Cancelled|Canceled|Inactive)[^]*?)(?:as of\s*([0-9A-Za-z ]+)|$)/i
          );
          const profileHref = (element.querySelector("a[href]") as HTMLAnchorElement | null)?.getAttribute("href") || "";
          const profileUrl = profileHref ? new URL(profileHref, window.location.href).toString() : window.location.href;
          const registrationNumber = profileUrl.match(/LicenceNumber=0*([0-9]+)/i)?.[1]?.trim();

          return {
            fullName: name,
            licenceStatus: nonActiveStatus ? nonActiveStatus[1].replace(/\s+/g, " ").trim() : undefined,
            licenceClass: specialty || undefined,
            registrationNumber,
            practiceType: specialty || undefined,
            profileUrl,
          };
        })
        .filter((result) => Boolean(result?.fullName));

      return results as RegistryResult[];
    });
  }

  if (institutionConfig.key === "cpspei" || institutionConfig.key === "cpsnl") {
    return page.locator("table tbody tr, table tr").evaluateAll((elements) => {
      const results = elements
        .map((element) => {
          const cells = element.querySelectorAll("td");
          if (cells.length < 2) return null;

          const memberLines = (((cells[0] as HTMLElement)?.innerText || cells[0]?.textContent || ""))
            .split(/\n+/)
            .map((line) => line.replace(/\s+/g, " ").trim())
            .filter(Boolean);
          const registrationLines = (((cells[1] as HTMLElement)?.innerText || cells[1]?.textContent || ""))
            .split(/\n+/)
            .map((line) => line.replace(/\s+/g, " ").trim())
            .filter(Boolean);
          const member = memberLines.find((line) => /,/.test(line)) || memberLines[0] || "";
          const registration = registrationLines.join(" ");
          if (!member || /^member$/i.test(member)) return null;

          const registrationNumber = member.match(/\(([^)]+)\)/)?.[1]?.trim();
          const anchor = element.querySelector("a[href]") as HTMLAnchorElement | null;
          const profileHref = anchor?.getAttribute("href") || "";
          const profileUrl = profileHref
            ? new URL(profileHref, window.location.href).toString()
            : window.location.href;

          return {
            fullName: member.replace(/\s*\([^)]+\)\s*$/, "").trim(),
            licenceStatus: undefined,
            licenceClass: registration || undefined,
            registrationNumber,
            practiceType: registration || undefined,
            profileUrl,
          };
        })
        .filter((result) => Boolean(result?.fullName));

      return results as RegistryResult[];
    });
  }

  if (institutionConfig.key === "cpsnb") {
    return page.locator("table tbody tr, table tr").evaluateAll((elements) => {
      const results = elements
        .map((element) => {
          const cells = element.querySelectorAll("td");
          const rowText = (element.textContent || "").replace(/\s+/g, " ").trim();
          if (!rowText || /Search for a specific physician|Specialty:|Registration number:/i.test(rowText)) return null;

          const cellTexts = Array.from(cells).map((cell) => (cell.textContent || "").replace(/\s+/g, " ").trim());
          const probableName = cellTexts.find((text) => /,/.test(text)) || rowText.match(/[A-Z][A-Za-z' -]+,\s*[A-Z][A-Za-z' .-]+/)?.[0];
          if (!probableName) return null;

          return {
            fullName: probableName,
            licenceStatus: undefined,
            licenceClass: cellTexts.find((text) => text !== probableName && text.length > 2) || undefined,
            profileUrl: window.location.href,
          };
        })
        .filter((result) => Boolean(result?.fullName));

      return results as RegistryResult[];
    });
  }

  if (institutionConfig.key === "cmq") {
    return page.locator("article, table tbody tr, .search-result, .c-card").evaluateAll((elements) => {
      const results = elements
        .map((element) => {
          const text = (element.textContent || "").replace(/\s+/g, " ").trim();
          const anchor = element.querySelector("a[href]") as HTMLAnchorElement | null;
          const fullName =
            (anchor?.textContent || "").replace(/\s+/g, " ").trim() ||
            text.match(/[A-ZÀ-Ÿ][A-Za-zÀ-ÿ' -]+,\s*[A-ZÀ-Ÿ][A-Za-zÀ-ÿ' .-]+/)?.[0] ||
            "";
          const profileHref = anchor?.getAttribute("href") || "";

          return {
            fullName,
            licenceStatus: text.match(/Statut\s*:?\s*([^|]+)/i)?.[1]?.trim(),
            licenceClass: text.match(/Sp[eé]cialit[eé]\s*:?\s*([^|]+)/i)?.[1]?.trim(),
            profileUrl: profileHref ? new URL(profileHref, window.location.href).toString() : window.location.href,
          };
        })
        .filter((result) => Boolean(result.fullName));

      return results as RegistryResult[];
    });
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
      const registrationNumber =
        text.match(/(?:Licence|License|Registration)\s*(?:Number|No\.?|#):\s*([A-Z0-9-]+)/i)?.[1]?.trim();
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
        registrationNumber,
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

function isCpsmVerifiedMembershipClass(value?: string) {
  const normalized = value?.toLowerCase() || "";
  if (!normalized) return false;
  if (
    normalized.includes("non-practising") ||
    normalized.includes("non-practicing") ||
    normalized.includes("suspend") ||
    normalized.includes("inactive") ||
    normalized.includes("expired") ||
    normalized.includes("cancel") ||
    normalized.includes("resign")
  ) {
    return false;
  }

  return normalized === "regulated member - full";
}

function normalizeCpsmMembershipClass(value: string) {
  const normalized = value.toLowerCase();

  if (normalized.includes("non-practising") || normalized.includes("non-practicing")) {
    return {
      status: "Non-practising",
      licenceClass: value.replace(/^regulated member\s*-\s*/i, "").trim() || value,
    };
  }

  if (normalized === "regulated member - full") {
    return {
      status: "Practising",
      licenceClass: "Full",
    };
  }

  return {
    status: value,
    licenceClass: value.replace(/^regulated member\s*-\s*/i, "").trim() || value,
  };
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

function normalizeCpsmPracticeTypes(value?: string) {
  return value
    ?.replace(/\bWithout:/g, " Without:")
    .split(/\n+|\s{2,}|\s*\|\s*/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(", ");
}

function parseCpsmModalText(modalText: string) {
  const cleanText = modalText.replace(/\s+/g, " ").trim();
  const registrationNumber = cleanText.match(/Registration Number\s*([0-9-]+)/i)?.[1]?.trim();
  const membershipClass = cleanText.match(/Membership Class\s*(.+?)\s*Gender/i)?.[1]?.trim();
  const rawFieldsOfPractice = modalText.match(/Fields of Practice\s+Name\s+Type\s+With\s+Without\s+Limited To\s*([\s\S]*?)\s*Filter/i)?.[1];
  const fieldsOfPractice = normalizeCpsmPracticeTypes(rawFieldsOfPractice?.replace(/\s*\|\|[\s\S]*$/, ""));

  return {
    registrationNumber,
    membershipClass,
    fieldsOfPractice,
  };
}

async function closeCpsmModal(page: Page, modal?: ReturnType<Page["locator"]>) {
  const modalContainer = modal?.locator('xpath=ancestor::div[contains(@class,"modal")][1]');
  const closeButton = (modalContainer || page)
    .locator('button[aria-label="Close"], button:has-text("CLOSE"), .pdfview-close')
    .first();

  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click({ force: true }).catch(() => page.keyboard.press("Escape"));
  } else {
    await page.keyboard.press("Escape").catch(() => undefined);
  }

  await page.locator(".modal.Show, .modal.show").first().waitFor({ state: "hidden", timeout: 5000 }).catch(() => undefined);
}

async function enrichCpsmResultsOnCurrentPage(page: Page, results: RegistryResult[]) {
  for (const result of results) {
    if (typeof result.rowIndex !== "number") continue;

    await page.locator(".listingCore tbody tr").nth(result.rowIndex).click();
    await page
      .waitForFunction(() => /Registration Number|Membership Class/i.test(document.body?.innerText || ""), undefined, {
        timeout: 10000,
      })
      .catch(() => undefined);
    const modal = page.locator(".custom-modal-body").filter({ hasText: /Registration Number/i }).first();
    await modal.waitFor({ state: "visible", timeout: 10000 }).catch(() => undefined);
    const modalText = await modal.innerText().catch(() => "");
    const parsed = parseCpsmModalText(modalText);

    if (parsed.registrationNumber) {
      result.registrationNumber = parsed.registrationNumber;
    }

    if (parsed.membershipClass) {
      const normalizedMembership = normalizeCpsmMembershipClass(parsed.membershipClass);
      result.licenceStatus = normalizedMembership.status;
      result.licenceClass = normalizedMembership.licenceClass;
    }

    if (parsed.fieldsOfPractice) {
      result.practiceType = parsed.fieldsOfPractice;
    }

    await closeCpsmModal(page, modal);
  }
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
    if (institutionConfig.key === "cpsm" && currentResults.length > 0) {
      await enrichCpsmResultsOnCurrentPage(page, currentResults);
    }
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
  const licenceNumber = (input.licenceNumber || "").trim();
  const institutionConfig = resolveInstitutionConfig(input.institution);
  const canSearchByFirstName = !["cpso", "cmq", "cpssk"].includes(institutionConfig.key);
  const searchLabel = firstName && canSearchByFirstName ? `${firstName} ${searchTerm}` : searchTerm;

  if (!searchTerm) {
    const requiredHint =
      institutionConfig.key === "cpso"
        ? "A CPSO # is required."
        : institutionConfig.key === "cpsns" || institutionConfig.key === "cpspei" || institutionConfig.key === "cpsnl"
        ? "A licence number is required."
        : "A last name is required.";
    return {
      outcome: "error",
      notes: requiredHint,
    };
  }

  if (institutionConfig.key === "cpssk") {
    return {
      outcome: "needs_review",
      sourceUrl: institutionConfig.baseUrl,
      notes:
        "CPSS has been added to the registry list, but its public site is blocking automated verification from the server. Open the official CPSS site to complete this one manually.",
    };
  }

  if (institutionConfig.key === "cmq") {
    return {
      outcome: "needs_review",
      sourceUrl: institutionConfig.baseUrl,
      notes:
        "CMQ has been added to the registry list, but its current public directory uses an anti-bot challenge that blocks server-side verification. Open the official CMQ directory to complete this one manually.",
    };
  }

  if (institutionConfig.key === "cpsnb") {
    return {
      outcome: "needs_review",
      sourceUrl: institutionConfig.baseUrl,
      notes:
        "CPSNB does not support automated verification in PaRx yet. Open the official CPSNB directory to review this search manually.",
    };
  }

  const { browser, context, page } = await createBrowserPage();
  let forceBrowserRecycle = false;

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
      } else if (institutionConfig.key === "cpsm") {
        const inputs = page.locator("input.form-control");
        await inputs.nth(0).waitFor({ state: "visible", timeout: 15000 });
        await inputs.nth(0).fill(searchTerm);
        if (firstName) {
          await inputs.nth(1).fill(firstName);
        }
        await clickFirstEnabled(page.getByRole("button", { name: /search/i }));
      } else if (institutionConfig.key === "cpsns") {
        await page.locator("#licencenumber").fill(licenceNumber || searchTerm);
        await page.locator("#search").click();
      } else if (institutionConfig.key === "cpspei") {
        await page.locator("#ParameterForm1000608_TextOptionC").fill(licenceNumber || searchTerm);
        await page.locator(".als-search-button").click();
      } else if (institutionConfig.key === "cpsnl") {
        await page.locator("#ParameterForm1000608_TextOptionC").fill(normalizeCpsnlLicenceSearch(licenceNumber || searchTerm));
        await page.locator(".als-search-button").click();
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

    if (["cpsa", "cpsm", "cpsns", "cpsnb", "cpspei", "cpsnl"].includes(institutionConfig.key)) {
      // The CPSA site renders results via an ASP.NET UpdatePanel AJAX postback.
      // Polling the DOM with waitForFunction right after the click races with
      // that in-flight postback and reproducibly corrupts the search (the
      // server ends up returning 0 matches for a real, existing physician).
      // Waiting for the network to settle avoids the interference.
      await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => undefined);
      await page.waitForTimeout(1500).catch(() => undefined);
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
        : /no results|no matches|did not match|0 results|0 member\(s\) found/i.test(lowerBodyText);

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

    if (institutionConfig.key === "cpsns" && normalizedResults.length > 0) {
      cpsaSourceUrl = firstResultsUrl;

      for (const result of normalizedResults) {
        if (!result.profileUrl) continue;

        await page.goto(result.profileUrl, { waitUntil: "domcontentloaded" });
        await page
          .waitForFunction(() => /Registrant Details|Licence No:/i.test(document.body?.innerText || ""), undefined, {
            timeout: 30000,
          })
          .catch(() => undefined);
        const enriched = await parseCpsnsDetailPage(page, result);
        const listingStatus = result.licenceStatus;
        result.fullName = enriched.fullName;
        result.licenceStatus = isCpsnsNonActiveListingStatus(listingStatus) ? listingStatus : enriched.licenceStatus;
        result.licenceClass = enriched.licenceClass;
        result.registrationNumber = enriched.registrationNumber;
        result.practiceType = enriched.practiceType;
        result.profileUrl = enriched.profileUrl;
      }

      if (normalizedResults.length === 1) {
        cpsaSourceUrl = normalizedResults[0].profileUrl || cpsaSourceUrl;
      }
    }

    if (institutionConfig.key === "cpspei" && normalizedResults.length > 0) {
      cpsaSourceUrl = firstResultsUrl;

      for (const result of normalizedResults) {
        if (!result.profileUrl) continue;

        await page.goto(result.profileUrl, { waitUntil: "domcontentloaded" });
        await page
          .waitForFunction(() => /Current Registration|Expiry/i.test(document.body?.innerText || ""), undefined, {
            timeout: 30000,
          })
          .catch(() => undefined);
        const enriched = await parseCpspeiDetailPage(page, result);
        result.fullName = enriched.fullName;
        result.licenceStatus = enriched.licenceStatus;
        result.licenceClass = enriched.licenceClass;
        result.registrationNumber = enriched.registrationNumber;
        result.practiceType = enriched.practiceType;
        result.profileUrl = enriched.profileUrl;
      }

      if (normalizedResults.length === 1) {
        cpsaSourceUrl = normalizedResults[0].profileUrl || cpsaSourceUrl;
      }
    }

    if (institutionConfig.key === "cpsnl" && normalizedResults.length > 0) {
      cpsaSourceUrl = firstResultsUrl;

      for (const result of normalizedResults) {
        if (!result.profileUrl) continue;

        await page.goto(result.profileUrl, { waitUntil: "domcontentloaded" });
        await page
          .waitForFunction(() => /Registration History|Expiry/i.test(document.body?.innerText || ""), undefined, {
            timeout: 30000,
          })
          .catch(() => undefined);
        const enriched = await parseCpsnlDetailPage(page, result);
        result.fullName = enriched.fullName;
        result.licenceStatus = enriched.licenceStatus;
        result.licenceClass = enriched.licenceClass;
        result.registrationNumber = enriched.registrationNumber;
        result.practiceType = enriched.practiceType;
        result.profileUrl = enriched.profileUrl;
      }

      if (normalizedResults.length === 1) {
        cpsaSourceUrl = normalizedResults[0].profileUrl || cpsaSourceUrl;
      }
    }

    const firstResult = normalizedResults[0];
    const cpsmHasUnverifiedFirstResult =
      institutionConfig.key === "cpsm" &&
      Boolean(firstResult) &&
      !(firstResult.licenceStatus === "Practising" && firstResult.licenceClass === "Full");
    const cpsnsHasUnverifiedFirstResult =
      institutionConfig.key === "cpsns" && Boolean(firstResult) && firstResult.licenceStatus !== "Practising";
    const cpspeiHasUnverifiedFirstResult =
      institutionConfig.key === "cpspei" && Boolean(firstResult) && firstResult.licenceStatus !== "Practising";
    const cpsnlHasUnverifiedFirstResult =
      institutionConfig.key === "cpsnl" && Boolean(firstResult) && firstResult.licenceStatus !== "Practising";

    return {
      outcome:
        normalizedResults.length === 0
          ? "not_found"
          : cpsmHasUnverifiedFirstResult ||
            cpsnsHasUnverifiedFirstResult ||
            cpspeiHasUnverifiedFirstResult ||
            cpsnlHasUnverifiedFirstResult
          ? "needs_review"
          : "possible_match",
      nameFound: firstResult?.fullName || searchLabel,
      licenceStatus: firstResult?.licenceStatus,
      licenceClass: firstResult?.licenceClass,
      cpsoNumber: firstResult?.cpsoNumber,
      sourceUrl: institutionConfig.key === "cpsbc" ? institutionConfig.baseUrl : cpsaSourceUrl ?? page.url(),
      notes:
        normalizedResults.length === 0
          ? `No ${institutionConfig.label} results found for ${searchLabel}.`
          : cpsmHasUnverifiedFirstResult
          ? `${institutionConfig.label} returned ${firstResult.licenceClass || firstResult.licenceStatus || "a membership class"} for ${searchLabel}. This should be reviewed before treating the prescriber as verified.`
          : cpsnsHasUnverifiedFirstResult
          ? `${institutionConfig.label} returned a licence record for ${searchLabel}, but the licence end date has passed. This prescriber should not be treated as verified.`
          : cpspeiHasUnverifiedFirstResult
          ? `${institutionConfig.label} returned a licence record for ${searchLabel}, but the expiry date has passed. This prescriber should not be treated as verified.`
          : cpsnlHasUnverifiedFirstResult
          ? `${institutionConfig.label} returned a licence record for ${searchLabel}, but the latest licence expiry date has passed. This prescriber should not be treated as verified.`
          : normalizedResults.length > 1
          ? `Multiple ${institutionConfig.label} results found for ${searchLabel}. Pulled results from ${pagesSearched} page${pagesSearched === 1 ? "" : "s"}${reachedPageLimit ? `, stopping at the ${MAX_RESULT_PAGES}-page safety limit` : ""}.`
          : `${institutionConfig.label} directory returned a result for ${searchLabel}.`,
      results: normalizedResults,
    };
  } catch (error) {
    forceBrowserRecycle = isBrowserResourceError(error);
    return {
      outcome: "error",
      notes: userSafeErrorMessage(error),
    };
  } finally {
    await releaseBrowser(browser, page, context, { forceClose: forceBrowserRecycle });
  }
}
