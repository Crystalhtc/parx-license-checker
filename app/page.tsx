"use client";

import { useState } from "react";
import * as XLSX from "xlsx";
import { resolveInstitutionConfig, type InstitutionKey } from "@/lib/institutionConfig";

const INSTITUTIONS: InstitutionKey[] = [
  "cpsbc",
  "cpso",
  "cpsa",
  "cpssk",
  "cpsm",
  "cmq",
  "cpsns",
  "cpsnb",
  "cpspei",
  "cpsnl",
];

const INSTITUTION_META: Record<
  InstitutionKey,
  { fullName: string; province: string; searchBy: string }
> = {
  cpsbc: {
    fullName: "College of Physicians and Surgeons of British Columbia",
    province: "British Columbia",
    searchBy: "Last name",
  },
  cpso: {
    fullName: "College of Physicians and Surgeons of Ontario",
    province: "Ontario",
    searchBy: "CPSO number",
  },
  cpsa: {
    fullName: "College of Physicians and Surgeons of Alberta",
    province: "Alberta",
    searchBy: "Last name",
  },
  cpssk: {
    fullName: "College of Physicians and Surgeons of Saskatchewan",
    province: "Saskatchewan",
    searchBy: "Last name",
  },
  cpsm: {
    fullName: "College of Physicians and Surgeons of Manitoba",
    province: "Manitoba",
    searchBy: "Last name",
  },
  cmq: {
    fullName: "College des medecins du Quebec",
    province: "Quebec",
    searchBy: "Last name or licence number",
  },
  cpsns: {
    fullName: "College of Physicians and Surgeons of Nova Scotia",
    province: "Nova Scotia",
    searchBy: "Licence number",
  },
  cpsnb: {
    fullName: "College of Physicians and Surgeons of New Brunswick",
    province: "New Brunswick",
    searchBy: "Last name",
  },
  cpspei: {
    fullName: "College of Physicians and Surgeons of Prince Edward Island",
    province: "Prince Edward Island",
    searchBy: "Licence number",
  },
  cpsnl: {
    fullName: "College of Physicians and Surgeons of Newfoundland and Labrador",
    province: "Newfoundland and Labrador",
    searchBy: "Licence number",
  },
};

type ResultItem = {
  fullName: string;
  licenceStatus?: string;
  licenceClass?: string;
  cpsoNumber?: string;
  registrationNumber?: string;
  practiceType?: string;
  profileUrl?: string;
};

type VerifyResult = {
  outcome: "possible_match" | "not_found" | "needs_review" | "error";
  nameFound?: string;
  licenceStatus?: string;
  licenceClass?: string;
  sourceUrl?: string;
  notes?: string;
  results?: ResultItem[];
};

type BulkResultItem = {
  rowNumber: number;
  firstName: string;
  lastName: string;
  licensingBody: string;
  licenceNumber: string;
  sourceRecord: CsvRecord;
  institution?: InstitutionKey;
  outcome: VerifyResult["outcome"] | "skipped";
  matchedName?: string;
  resultLicenceNumber?: string;
  licenceStatus?: string;
  licenceClass?: string;
  sourceUrl?: string;
  notes?: string;
};

type BulkResult = {
  totalRows: number;
  checkedRows: number;
  skippedRows: number;
  limitReached: boolean;
  sourceHeaders: string[];
  results: BulkResultItem[];
};

const OUTCOME_META: Record<VerifyResult["outcome"], { label: string; badge: string; panel: string }> = {
  possible_match: {
    label: "Possible match",
    badge: "bg-success text-white",
    panel: "border-success/25 bg-accent-soft",
  },
  not_found: {
    label: "No match found",
    badge: "bg-ink/10 text-ink",
    panel: "border-ink/15 bg-surface",
  },
  needs_review: {
    label: "Needs review",
    badge: "bg-warning/15 text-warning",
    panel: "border-warning/25 bg-field",
  },
  error: {
    label: "Error",
    badge: "bg-danger text-white",
    panel: "border-danger/25 bg-danger/10",
  },
};

function isActiveStatus(status?: string) {
  const normalized = status?.toLowerCase();
  if (!normalized || normalized.includes("non-practising") || normalized.includes("non-practicing")) {
    return false;
  }

  return normalized === "practising" || normalized === "active" || normalized === "regulated member - full";
}

function getStatusTone(status?: string) {
  const normalized = status?.toLowerCase() ?? "";

  if (!status) {
    return {
      label: "Status unavailable",
      className: "bg-unknown text-white ring-2 ring-unknown/20",
      icon: "unknown" as const,
    };
  }

  if (isActiveStatus(status)) {
    return {
      label: status,
      className: "bg-success text-white ring-2 ring-success/20",
      icon: "check" as const,
    };
  }

  if (
    normalized.includes("suspend") ||
    normalized.includes("cancel") ||
    normalized.includes("revok") ||
    normalized.includes("resign") ||
    normalized.includes("inactive") ||
    normalized.includes("expired") ||
    normalized.includes("not verified")
  ) {
    return {
      label: status,
      className: "bg-danger text-white ring-2 ring-danger/20",
      icon: "alert" as const,
    };
  }

  return {
    label: status,
    className: "bg-warning text-white ring-2 ring-warning/20",
    icon: "review" as const,
  };
}

function StatusIcon({ type }: { type: "check" | "alert" | "review" | "unknown" }) {
  if (type === "check") {
    return (
      <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="m3.5 8.2 2.7 2.7 6.3-6.8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (type === "alert") {
    return (
      <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 2.3 14 13H2L8 2.3Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
        <path d="M8 6.2v3.1M8 11.6h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }

  if (type === "review") {
    return (
      <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <circle cx="8" cy="8" r="5.8" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 4.8V8l2.2 1.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.8" stroke="currentColor" strokeWidth="1.8" />
      <path d="M6.5 6.4A1.7 1.7 0 0 1 8 5.5c1 0 1.8.6 1.8 1.5 0 1.2-1.5 1.3-1.5 2.5M8.3 11.5h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function StatusBadge({ status }: { status?: string }) {
  const tone = getStatusTone(status);

  return (
    <span
      className={`inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-left text-xs font-black uppercase shadow-sm ${tone.className}`}
    >
      <StatusIcon type={tone.icon} />
      {tone.label}
    </span>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 2.5v7M5.25 7.25 8 10l2.75-2.75M3 13.5h10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 11.5v-8M4.75 6.75 8 3.5l3.25 3.25M3 12.5h10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M10 3.5 5.5 8l4.5 4.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RegistryOption({
  institutionKey,
  checked,
  onChange,
}: {
  institutionKey: InstitutionKey;
  checked: boolean;
  onChange: () => void;
}) {
  const config = resolveInstitutionConfig(institutionKey);
  const meta = INSTITUTION_META[institutionKey];

  return (
    <label
      className={`relative flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition ${
        checked
          ? "border-accent bg-accent text-white shadow-sm"
          : "border-line bg-field text-ink hover:border-accent/50 hover:bg-accent-soft"
      }`}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
          checked ? "border-white" : "border-ink/45"
        }`}
      >
        <input
          type="radio"
          name="institution"
          checked={checked}
          onChange={onChange}
          className="sr-only"
        />
        <span className={`h-2.5 w-2.5 rounded-full ${checked ? "bg-white" : "bg-transparent"}`} />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold leading-none">{config.label}</span>
        <span className={`mt-1 block truncate text-xs font-semibold ${checked ? "text-white/75" : "text-ink/55"}`}>
          {meta.fullName}
        </span>
        <span className={`mt-0.5 block truncate text-xs font-semibold ${checked ? "text-white/65" : "text-ink/45"}`}>
          {meta.province}
        </span>
      </span>
    </label>
  );
}

function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-bold text-ink">
      {children}
    </label>
  );
}

function DetailBlock({ label, value }: { label: string; value?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line bg-field px-4 py-3 sm:rounded-[20px]">
      <dt className="text-[11px] font-bold uppercase text-ink/50">{label}</dt>
      <dd className="mt-1 min-h-6 break-words text-sm font-bold leading-snug text-ink">{value || "-"}</dd>
    </div>
  );
}

function BulkOutcomeBadge({ outcome }: { outcome: BulkResultItem["outcome"] }) {
  const label = outcome === "skipped" ? "Skipped" : OUTCOME_META[outcome].label;
  const className =
    outcome === "skipped"
      ? "bg-unknown text-white"
      : OUTCOME_META[outcome].badge;

  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-black uppercase ${className}`}>
      {label}
    </span>
  );
}

type CsvRecord = Record<string, string>;
type UploadedRecord = {
  normalized: CsvRecord;
  original: CsvRecord;
};

type UploadedRows = {
  headers: string[];
  records: UploadedRecord[];
};

const IMPORT_COLUMN_ALIASES = {
  firstName: ["First Name", "Given Name", "Given Names", "Forename", "First"],
  lastName: ["Last Name", "Surname", "Family Name", "Last"],
  licensingBody: [
    "Licensing Body",
    "Licence Body",
    "License Body",
    "Licensing College",
    "Licence College",
    "License College",
    "Regulatory Body",
    "Regulator",
    "College",
    "Institution",
    "Registry",
  ],
  licenceNumber: [
    "Licence Number",
    "License Number",
    "Registration Number",
    "Registration ID",
    "Registration No",
    "Licence No",
    "License No",
    "CPSO Number",
    "CPSO #",
    "Member Number",
    "Member ID",
  ],
  province: ["Province", "Jurisdiction", "Province/Territory", "Province or Territory"],
};

function parseCsv(text: string) {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"' && inQuotes && nextCharacter === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (character === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      row.push(field);
      rows.push(row);
      field = "";
      row = [];
      continue;
    }

    field += character;
  }

  row.push(field);
  rows.push(row);

  return rows;
}

function normalizeCsvHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function recordsFromCsv(text: string) {
  return recordsFromRows(parseCsv(text));
}

function recordsFromRows(parsedRows: string[][]) {
  const nonEmptyRows = parsedRows.filter((row) => row.some((field) => String(field).trim()));
  const [headers = [], ...dataRows] = nonEmptyRows;
  const sourceHeaders = headers.map((header, index) => header.trim() || `Column ${index + 1}`);
  const normalizedHeaders = headers.map(normalizeCsvHeader);

  return {
    headers: sourceHeaders,
    records: dataRows.map((dataRow) => {
      const normalized: CsvRecord = {};
      const original: CsvRecord = {};

      dataRow.forEach((field, index) => {
        const normalizedHeader = normalizedHeaders[index] || `column${index}`;
        const sourceHeader = sourceHeaders[index] || `Column ${index + 1}`;
        normalized[normalizedHeader] = field.trim();
        original[sourceHeader] = field.trim();
      });

      return { normalized, original };
    }),
  };
}

async function recordsFromUpload(file: File): Promise<UploadedRows> {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "xlsx" || extension === "xls") {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const firstSheetName = workbook.SheetNames[0];
    const firstSheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined;
    if (!firstSheet) return { headers: [], records: [] };

    const rows = XLSX.utils.sheet_to_json<string[]>(firstSheet, {
      header: 1,
      defval: "",
      raw: false,
    });

    return recordsFromRows(rows.map((row) => row.map((cell) => String(cell).trim())));
  }

  return recordsFromCsv(await file.text());
}

function csvValue(record: CsvRecord, aliases: string[]) {
  for (const alias of aliases) {
    const value = record[normalizeCsvHeader(alias)];
    if (value) return value;
  }

  return "";
}

function detectInstitution(licensingBody: string, province: string): InstitutionKey | undefined {
  const normalizedBody = licensingBody.toLowerCase();
  const normalizedProvince = province.toLowerCase();
  const normalized = normalizedBody || normalizedProvince;
  const hasPhysicianCollegeName = /college of physicians (and|&) surgeons|coll[eè]ge des m[eé]decins/i.test(normalized);

  if (/(^|\b)cpsbc(\b|$)|college of physicians (and|&) surgeons of british columbia/i.test(normalized)) return "cpsbc";
  if (/(^|\b)cpso(\b|$)|college of physicians (and|&) surgeons of ontario/i.test(normalized)) return "cpso";
  if (/(^|\b)cpsa(\b|$)|college of physicians (and|&) surgeons of alberta/i.test(normalized)) return "cpsa";
  if (/(^|\b)cpssk(\b|$)|(^|\b)cps\.sk(\b|$)|college of physicians (and|&) surgeons of saskatchewan/i.test(normalized)) return "cpssk";
  if (/(^|\b)cpsm(\b|$)|college of physicians (and|&) surgeons of manitoba/i.test(normalized)) return "cpsm";
  if (/(^|\b)cmq(\b|$)|coll[eè]ge des m[eé]decins du qu[eé]bec|college des medecins du quebec/i.test(normalized)) return "cmq";
  if (/(^|\b)cpsns(\b|$)|college of physicians (and|&) surgeons of nova scotia/i.test(normalized)) return "cpsns";
  if (/(^|\b)cpsnb(\b|$)|college of physicians (and|&) surgeons of new brunswick/i.test(normalized)) return "cpsnb";
  if (/(^|\b)cpspei(\b|$)|college of physicians (and|&) surgeons of prince edward island/i.test(normalized)) return "cpspei";
  if (/(^|\b)cpsnl(\b|$)|college of physicians (and|&) surgeons of newfoundland and labrador/i.test(normalized)) return "cpsnl";

  if (hasPhysicianCollegeName) return undefined;

  return undefined;
}

function resultMatchesLicenceNumber(result: ResultItem, licenceNumber: string) {
  if (!licenceNumber) return false;

  const normalizedLicenceNumber = licenceNumber.replace(/\D/g, "");
  return [result.cpsoNumber, result.registrationNumber, result.licenceClass]
    .filter(Boolean)
    .some((value) => value?.replace(/\D/g, "") === normalizedLicenceNumber);
}

function pickBestResult(verification: VerifyResult, licenceNumber: string) {
  const results = verification.results || [];
  return results.find((item) => resultMatchesLicenceNumber(item, licenceNumber)) || results[0];
}

function registryLicenceNumberFromResult(result?: ResultItem) {
  if (!result) return undefined;
  const fromClass = result.licenceClass?.match(/(?:CPSO|Licence|License|Registration)\s*(?:#|Number|No\.?)?\s*:?\s*([A-Z0-9-]+)/i)?.[1];
  const fromUrl = result.profileUrl?.match(/(?:cpsonum|LicenceNumber)=0*([A-Z0-9-]+)/i)?.[1];
  return result.registrationNumber || result.cpsoNumber || fromClass || fromUrl;
}

function rowErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Verification failed for this row.";
  const firstLine = message.split("\n")[0]?.trim();
  return firstLine || "Verification failed for this row.";
}

async function readVerifyResponse(response: Response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return (await response.json().catch(() => ({
      outcome: "error",
      notes: "Verification failed for this row.",
    }))) as VerifyResult;
  }

  const text = await response.text().catch(() => "");
  return {
    outcome: "error",
    notes: text.trim() || `Verification service returned HTTP ${response.status}.`,
  } as VerifyResult;
}

function requiresManualRegistryReview(item: Pick<BulkResultItem, "institution" | "outcome">) {
  return !item.institution || item.outcome === "skipped" || item.institution === "cpssk" || item.institution === "cmq" || item.institution === "cpsnb";
}

function verifiedValue(item: BulkResultItem) {
  if (item.institution === "cpsm" && item.outcome === "not_found") {
    return "not verified";
  }

  if (item.outcome === "needs_review" || item.outcome === "not_found" || item.outcome === "skipped" || item.outcome === "error") {
    return "";
  }

  return isActiveStatus(item.licenceStatus) ? "verified" : "not verified";
}

function exportableResultLink(item: BulkResultItem) {
  if (!item.sourceUrl || requiresManualRegistryReview(item)) return "";
  if (item.institution === "cpsbc" || item.institution === "cpsm") return "";
  return item.sourceUrl;
}

function directoryUrlForInstitution(institution?: InstitutionKey) {
  return institution ? resolveInstitutionConfig(institution).baseUrl : "";
}

function bulkActionUrl(item: BulkResultItem) {
  if (!item.institution) return "";
  if (item.outcome === "not_found" || requiresManualRegistryReview(item) || item.institution === "cpsm") {
    return directoryUrlForInstitution(item.institution);
  }
  return item.sourceUrl || "";
}

function bulkActionLabel(item: BulkResultItem) {
  if (item.outcome === "not_found" || requiresManualRegistryReview(item) || item.institution === "cpsm") {
    return "Open directory search page";
  }
  return "Open source result";
}

export default function Home() {
  const [mobileStep, setMobileStep] = useState<1 | 2 | 3>(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [firstName, setFirstName] = useState("");
  const [institutionQuery, setInstitutionQuery] = useState("");
  const [institution, setInstitution] = useState<InstitutionKey>("cpsbc");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkDragActive, setBulkDragActive] = useState(false);
  const [downloadingPdfKey, setDownloadingPdfKey] = useState<string | null>(null);
  const [submittedSearchTerm, setSubmittedSearchTerm] = useState("");
  const [submittedFirstName, setSubmittedFirstName] = useState("");

  const institutionConfig = resolveInstitutionConfig(institution);
  const institutionMeta = INSTITUTION_META[institution];
  const acceptsFirstName =
    institution !== "cpso" &&
    institution !== "cmq" &&
    institution !== "cpssk" &&
    institution !== "cpsns" &&
    institution !== "cpspei" &&
    institution !== "cpsnl";
  const filteredInstitutions = INSTITUTIONS.filter((key) => {
    const config = resolveInstitutionConfig(key);
    const meta = INSTITUTION_META[key];
    const query = institutionQuery.trim().toLowerCase();

    if (!query) return true;

    return [config.label, meta.fullName, meta.province]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });

  async function checkRegistry() {
    const submittedTerm = searchTerm.trim();
    const submittedGivenName = acceptsFirstName ? firstName.trim() : "";

    setMobileStep(3);
    setLoading(true);
    setResult(null);
    setBulkResult(null);
    setSubmittedSearchTerm(submittedTerm);
    setSubmittedFirstName(submittedGivenName);

    try {
      const response = await fetch("/api/verify-cpsbc", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          searchTerm: submittedTerm,
          firstName: submittedGivenName,
          institution,
        }),
      });

      const data = await response.json();
      setResult(data);
    } catch {
      setResult({
        outcome: "error",
        notes: "Something went wrong reaching the verification service. Please try again.",
      });
      setBulkResult(null);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!searchTerm.trim() || loading) return;
    void checkRegistry();
  }

  async function processCsvFile(file: File) {
    if (!file || bulkLoading) return;

    setMobileStep(3);
    setBulkLoading(true);
    setResult(null);
    setBulkResult(null);

    try {
      const uploadedRows = await recordsFromUpload(file);
      const records = uploadedRows.records;
      const importedRows: BulkResultItem[] = [];

      if (records.length === 0) {
        throw new Error("File has no importable rows.");
      }

      setBulkResult({
        totalRows: records.length,
        checkedRows: 0,
        skippedRows: 0,
        limitReached: false,
        sourceHeaders: uploadedRows.headers,
        results: [],
      });

      for (const [index, record] of records.entries()) {
        const firstName = csvValue(record.normalized, IMPORT_COLUMN_ALIASES.firstName);
        const lastName = csvValue(record.normalized, IMPORT_COLUMN_ALIASES.lastName);
        const licensingBody = csvValue(record.normalized, IMPORT_COLUMN_ALIASES.licensingBody);
        const licenceNumber = csvValue(record.normalized, IMPORT_COLUMN_ALIASES.licenceNumber);
        const province = csvValue(record.normalized, IMPORT_COLUMN_ALIASES.province);
        const detectedInstitution = detectInstitution(licensingBody, province);
        const rowNumber = index + 2;

        if (!detectedInstitution) {
          importedRows.push({
            rowNumber,
            firstName,
            lastName,
            licensingBody,
            licenceNumber,
            sourceRecord: record.original,
            outcome: "needs_review",
            notes: "Licensing body is not included in PaRx yet. Review this prescriber manually.",
          });
        } else {
          const rowSearchTerm =
            detectedInstitution === "cpso" ||
            detectedInstitution === "cpsns" ||
            detectedInstitution === "cpspei" ||
            detectedInstitution === "cpsnl"
              ? licenceNumber || lastName
              : lastName || licenceNumber;

          if (!rowSearchTerm) {
            importedRows.push({
              rowNumber,
              firstName,
              lastName,
              licensingBody,
              licenceNumber,
              sourceRecord: record.original,
              institution: detectedInstitution,
              outcome: "skipped",
              notes:
                detectedInstitution === "cpso" ||
                detectedInstitution === "cpsns" ||
                detectedInstitution === "cpspei" ||
                detectedInstitution === "cpsnl"
                  ? "Licence number is missing."
                  : "Last name is missing.",
            });
          } else {
            try {
              const response = await fetch("/api/verify-cpsbc", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  institution: detectedInstitution,
                  searchTerm: rowSearchTerm,
                  firstName:
                    detectedInstitution !== "cpso" &&
                    detectedInstitution !== "cmq" &&
                    detectedInstitution !== "cpssk" &&
                    detectedInstitution !== "cpsns" &&
                    detectedInstitution !== "cpspei" &&
                    detectedInstitution !== "cpsnl"
                      ? firstName
                      : undefined,
                  licenceNumber,
                }),
              });
              const verification = await readVerifyResponse(response);

              if (!response.ok) {
                throw new Error(verification.notes || `Verification service returned HTTP ${response.status}.`);
              }

              const matchedResult = pickBestResult(verification, licenceNumber);
              const hasRegistryMatch = verification.outcome === "possible_match" || verification.outcome === "needs_review";
              const bulkLicenceStatus =
                detectedInstitution === "cpsm" && verification.outcome === "not_found"
                  ? "Not verified"
                  : matchedResult?.licenceStatus || verification.licenceStatus;

              importedRows.push({
                rowNumber,
                firstName,
                lastName,
                licensingBody,
                licenceNumber,
                sourceRecord: record.original,
                institution: detectedInstitution,
                outcome: verification.outcome,
                matchedName: hasRegistryMatch ? matchedResult?.fullName || verification.nameFound : undefined,
                resultLicenceNumber: hasRegistryMatch ? registryLicenceNumberFromResult(matchedResult) : undefined,
                licenceStatus: bulkLicenceStatus,
                licenceClass: hasRegistryMatch ? matchedResult?.licenceClass || verification.licenceClass : undefined,
                sourceUrl: matchedResult?.profileUrl || verification.sourceUrl,
                notes: verification.notes,
              });
            } catch (error) {
              importedRows.push({
                rowNumber,
                firstName,
                lastName,
                licensingBody,
                licenceNumber,
                sourceRecord: record.original,
                institution: detectedInstitution,
                outcome: "error",
                notes: rowErrorMessage(error),
              });
            }
          }
        }

        setBulkResult({
          totalRows: records.length,
          checkedRows: importedRows.filter((item) => item.outcome !== "skipped").length,
          skippedRows: importedRows.filter((item) => item.outcome === "skipped").length,
          limitReached: false,
          sourceHeaders: uploadedRows.headers,
          results: [...importedRows],
        });
      }
    } catch {
      setResult({
        outcome: "error",
        notes: "The file could not be imported. Please upload a CSV or Excel file and try again.",
      });
      setBulkResult(null);
    } finally {
      setBulkLoading(false);
      setBulkDragActive(false);
    }
  }

  async function importCsv(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    try {
      if (file) {
        await processCsvFile(file);
      }
    } finally {
      event.target.value = "";
    }
  }

  function downloadUpdatedBulkFile() {
    if (!bulkResult) return;

    const prescriberStatusIndex = bulkResult.sourceHeaders.findIndex((header) => normalizeCsvHeader(header) === "prescriberstatus");
    const hasPrescriberStatusColumn = prescriberStatusIndex >= 0;
    const sourceHeaders = hasPrescriberStatusColumn
      ? bulkResult.sourceHeaders
      : [...bulkResult.sourceHeaders, "Prescriber Status"];
    const outputHeaders = [...sourceHeaders, "Result Link"];
    const rows = bulkResult.results.map((item) => {
      const resultLink = exportableResultLink(item);
      const sourceValues = sourceHeaders.map((header, index) => {
        if (!hasPrescriberStatusColumn && index === sourceHeaders.length - 1) {
          return verifiedValue(item);
        }
        if (hasPrescriberStatusColumn && index === prescriberStatusIndex) {
          return verifiedValue(item);
        }
        return item.sourceRecord[header] || "";
      });
      return [
        ...sourceValues,
        resultLink ? { t: "s", v: resultLink, l: { Target: resultLink } } : "",
      ];
    });
    const worksheet = XLSX.utils.aoa_to_sheet([outputHeaders, ...rows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Verified Results");
    XLSX.writeFile(workbook, "parx-verified-results.xlsx");
  }

  function handleBulkDrag(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!bulkLoading) {
      setBulkDragActive(event.type === "dragenter" || event.type === "dragover");
    }
  }

  function handleBulkDrop(event: React.DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    setBulkDragActive(false);

    const file = event.dataTransfer.files?.[0];
    if (file) {
      void processCsvFile(file);
    }
  }

  async function downloadCpsbcPdf(
    item: ResultItem,
    index: number,
    searchOverride?: { lastName?: string; firstName?: string }
  ) {
    if (!item.profileUrl && !searchOverride?.lastName) return;

    const downloadKey = `${item.fullName}-${index}`;
    setDownloadingPdfKey(downloadKey);

    try {
      const response = await fetch("/api/download-cpsbc-pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          profileUrl: item.profileUrl,
          fullName: item.fullName,
          searchTerm: searchOverride?.lastName || submittedSearchTerm || searchTerm.trim(),
          firstName: searchOverride?.firstName || submittedFirstName || firstName.trim(),
        }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        throw new Error(errorBody?.error || "Unable to download CPSBC PDF.");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${item.fullName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "cpsbc-result"}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setResult({
        outcome: "error",
        notes: "The CPSBC PDF could not be downloaded. Please try again.",
      });
    } finally {
      setDownloadingPdfKey(null);
    }
  }

  const outcomeMeta = result ? OUTCOME_META[result.outcome] : null;
  const isErrorOutcome = result?.outcome === "error";
  const resultCount = result?.results?.length ?? 0;
  const displayCount = bulkResult ? bulkResult.results.length : resultCount;
  const bulkFinishedRows = bulkResult ? bulkResult.checkedRows + bulkResult.skippedRows : 0;
  const bulkProgressPercent = bulkResult?.totalRows
    ? Math.round((bulkFinishedRows / bulkResult.totalRows) * 100)
    : 0;
  const resultHeading = bulkResult
    ? bulkLoading
      ? `Checking ${bulkFinishedRows} of ${bulkResult.totalRows} rows`
      : `${displayCount} rows imported`
    : result
      ? resultCount === 1
        ? "1 record returned"
        : `${resultCount} records returned`
      : "Ready to search";

  return (
    <main className="flex min-h-screen bg-background text-ink sm:px-6 sm:py-5 lg:h-screen lg:min-h-0 lg:overflow-hidden">
      <section className="mx-auto grid min-h-screen w-full max-w-[1360px] gap-7 bg-paper px-4 py-6 shadow-xl shadow-ink/5 sm:min-h-0 sm:rounded-lg sm:border sm:border-line sm:px-8 sm:py-10 lg:h-full lg:grid-cols-[minmax(300px,420px)_1fr] lg:gap-16 lg:overflow-hidden lg:px-14 lg:py-12">
        <aside className={`${mobileStep === 3 ? "hidden lg:block" : "block"} min-w-0 lg:h-full lg:min-h-0 lg:overflow-hidden lg:pr-1`}>
          <form onSubmit={handleSubmit} className="space-y-6 sm:space-y-8 lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:gap-6 lg:space-y-0">
            <div className={`${mobileStep === 1 ? "block" : "hidden"} lg:block lg:shrink-0 lg:overflow-visible lg:pr-1`}>
              <p className="mb-5 inline-flex rounded-full bg-accent-soft px-4 py-2 text-sm font-black text-accent">
                PaRx
              </p>
              <h1 className="font-heading mb-7 text-3xl font-black leading-[0.95] text-ink sm:mb-8 sm:text-5xl lg:text-4xl">
                Prescriber
                <br />
                Licence
                Checker
              </h1>

              <div className="mt-6 space-y-3">
                <label
                  onDragEnter={handleBulkDrag}
                  onDragOver={handleBulkDrag}
                  onDragLeave={handleBulkDrag}
                  onDrop={handleBulkDrop}
                  className={`flex min-h-36 w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-5 py-6 text-center transition focus-within:ring-2 focus-within:ring-accent/35 ${
                    bulkDragActive
                      ? "border-accent bg-accent-soft ring-4 ring-accent/15"
                      : "border-line bg-surface hover:border-accent/60 hover:bg-accent-soft"
                  }`}
                >
                  <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-white shadow-sm">
                    {bulkLoading ? <Spinner /> : <UploadIcon />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-black uppercase text-accent">Bulk import</span>
                    <span className="mt-1 block text-base font-black leading-tight text-ink">
                      {bulkLoading ? "Importing file..." : "Drag CSV or Excel here, or click to upload"}
                    </span>
                    <span className="mt-1 block text-xs font-bold text-ink/45">CSV, XLSX, or XLS files</span>
                  </span>
                  <input
                    type="file"
                    accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    className="sr-only"
                    onChange={(event) => void importCsv(event)}
                    disabled={bulkLoading || loading}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setMobileStep(2)}
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-line bg-field px-5 py-3 text-sm font-black text-ink transition hover:border-accent/50 hover:bg-accent-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 lg:hidden"
                >
                  Manual search
                </button>
              </div>
            </div>

            <div className={`${mobileStep === 2 ? "block" : "hidden"} lg:block lg:shrink-0`}>
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-ink/12" />
                <span className="rounded-full border border-line bg-paper px-3 py-1 text-[11px] font-black uppercase text-ink/45">
                  or
                </span>
                <span className="h-px flex-1 bg-ink/12" />
              </div>
            </div>

            <div className={`${mobileStep === 2 ? "block" : "hidden"} space-y-5 lg:block lg:min-h-0 lg:shrink lg:overflow-y-auto lg:bg-paper lg:pr-1`}>
              <div className="flex items-center justify-between gap-3 lg:hidden">
                <button
                  type="button"
                  onClick={() => setMobileStep(1)}
                  aria-label="Go back to registry selection"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-field text-ink transition hover:border-accent/50 hover:bg-accent-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
                >
                  <BackIcon />
                </button>
                <span className="rounded-full border border-line bg-surface px-4 py-2 text-xs font-black uppercase text-ink/70">
                  {institutionConfig.label}
                </span>
              </div>

              <div>
                <p className="text-xs font-black uppercase text-ink/50">Manual search</p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <FieldLabel>Registry</FieldLabel>
                  <span className="text-xs font-bold uppercase text-ink/50">
                    {filteredInstitutions.length} of {INSTITUTIONS.length}
                  </span>
                </div>
                <input
                  className="w-full rounded-full border border-line bg-field px-4 py-3 text-sm font-bold text-ink placeholder:text-ink/35 focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
                  placeholder="Search institution"
                  value={institutionQuery}
                  onChange={(event) => setInstitutionQuery(event.target.value)}
                  autoComplete="off"
                />
                <div role="radiogroup" aria-label="Institution" className="grid gap-3">
                  {filteredInstitutions.map((key) => (
                    <RegistryOption
                      key={key}
                      institutionKey={key}
                      checked={institution === key}
                      onChange={() => {
                        setInstitution(key);
                        setSearchTerm("");
                        setFirstName("");
                        setSubmittedSearchTerm("");
                        setSubmittedFirstName("");
                        setResult(null);
                        setBulkResult(null);
                      }}
                    />
                  ))}
                </div>
                {filteredInstitutions.length === 0 && (
                  <p className="rounded-2xl border border-dashed border-line bg-surface px-4 py-3 text-sm font-bold text-ink/55">
                    No institutions match that search.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <FieldLabel htmlFor="search-term">{institutionMeta.searchBy} *</FieldLabel>
                <input
                  id="search-term"
                  className="w-full rounded-full border border-line bg-field px-6 py-4 text-base font-bold text-ink placeholder:text-ink/35 focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
                  placeholder={institutionConfig.searchPlaceholder}
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  autoComplete="off"
                />
              </div>

              {acceptsFirstName && (
                <div className="space-y-2">
                  <FieldLabel htmlFor="first-name">First name</FieldLabel>
                  <input
                    id="first-name"
                    className="w-full rounded-full border border-line bg-field px-6 py-4 text-base font-bold text-ink placeholder:text-ink/35 focus:outline-none focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25"
                    placeholder="Optional"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    autoComplete="off"
                  />
                </div>
              )}

              <button
                type="submit"
                className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-full bg-accent px-7 py-4 text-sm font-black text-white transition hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:cursor-not-allowed disabled:opacity-45"
                disabled={loading || bulkLoading || !searchTerm.trim()}
              >
                {loading && <Spinner />}
                {loading ? "Checking..." : `Check ${institutionConfig.label}`}
              </button>
            </div>
          </form>
        </aside>

        <section className={`${mobileStep === 3 ? "block" : "hidden"} min-w-0 space-y-4 sm:space-y-5 lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden`}>
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-ink/18 pb-4 lg:shrink-0">
            <div className="min-w-0">
              <p className="text-xs font-black uppercase text-ink/50">Results</p>
              <h2 className="font-heading mt-2 text-2xl font-black text-ink sm:text-3xl">
                {resultHeading}
              </h2>
            </div>
            <span className="rounded-full border border-line bg-surface px-4 py-2 text-xs font-black uppercase text-ink/70">
              {bulkResult ? "Bulk import" : institutionConfig.label}
            </span>
          </div>

          <div className="lg:hidden">
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setSearchTerm("");
                setFirstName("");
                setSubmittedSearchTerm("");
                setSubmittedFirstName("");
                setBulkResult(null);
                setMobileStep(1);
              }}
              disabled={bulkLoading}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 disabled:cursor-not-allowed disabled:opacity-45"
            >
              New Search
            </button>
          </div>

          {!result && !bulkResult && (
            <div className="flex min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-line bg-surface px-6 py-6 sm:min-h-[380px] sm:rounded-[30px] lg:flex-1">
              <p className="text-base font-black text-ink/55">{loading || bulkLoading ? "Checking..." : "No search run yet"}</p>
            </div>
          )}

          {bulkResult && (
            <div aria-live="polite" className="space-y-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-2">
              <div className={`space-y-3 rounded-2xl border px-4 py-4 sm:rounded-[30px] sm:px-6 sm:py-5 ${
                bulkLoading ? "border-accent/25 bg-accent-soft" : "border-success/25 bg-accent-soft"
              }`}>
                <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black uppercase text-white ${
                  bulkLoading ? "bg-accent" : "bg-success"
                }`}>
                  {bulkLoading && <Spinner />}
                  {bulkLoading ? "Checking file rows" : "Bulk import complete"}
                </span>
                <p className="text-sm font-bold text-ink/65">
                  {bulkLoading ? "Please keep this page open until all rows are checked. " : ""}
                  Checked {bulkFinishedRows} of {bulkResult.totalRows} rows.
                  {bulkResult.skippedRows > 0 ? ` ${bulkResult.skippedRows} skipped.` : ""}
                  {bulkResult.limitReached ? " Import stopped at the 50-row safety limit." : ""}
                </p>
                <div className="h-3 overflow-hidden rounded-full bg-ink/10" aria-label={`Bulk import ${bulkProgressPercent}% complete`}>
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${bulkProgressPercent}%` }}
                  />
                </div>
                {!bulkLoading && bulkResult.results.length > 0 && (
                  <button
                    type="button"
                    onClick={downloadUpdatedBulkFile}
                    className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-black text-white transition hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 sm:w-auto"
                  >
                    Download updated file
                    <DownloadIcon />
                  </button>
                )}
              </div>

              <div className="space-y-4">
                {bulkResult.results.map((item) => {
                  const detectedRegistry = item.institution ? resolveInstitutionConfig(item.institution).label : "Unknown";
                  const inputName = [item.firstName, item.lastName].filter(Boolean).join(" ") || "Unnamed row";
                  const bulkItemKey = `${item.matchedName || inputName}-${item.rowNumber}`;
                  const requiresManualReview = requiresManualRegistryReview(item);
                  const isUnknownRegistry = !item.institution;
                  const actionUrl = bulkActionUrl(item);
                  const cpsbcResultItem: ResultItem = {
                    fullName: item.matchedName || inputName,
                    licenceStatus: item.licenceStatus,
                    licenceClass: item.licenceClass,
                    profileUrl: item.sourceUrl,
                  };

                  return (
                    <article
                      key={`${item.rowNumber}-${item.licenceNumber}-${item.lastName}`}
                      className={`min-w-0 space-y-4 rounded-2xl border p-4 sm:rounded-[30px] sm:p-5 ${
                        requiresManualReview
                          ? "border-warning/35 bg-warning/10 ring-2 ring-warning/10"
                          : "border-ink/10 bg-surface"
                      }`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-black uppercase text-ink/45">File row {item.rowNumber}</p>
                          <h3 className="font-heading mt-1 break-words text-xl font-black text-ink sm:text-2xl">
                            {inputName}
                          </h3>
                          <p className="mt-1 break-words text-sm font-bold text-ink/55">
                            {detectedRegistry}
                          </p>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                          <BulkOutcomeBadge outcome={item.outcome} />
                          {!requiresManualReview && <StatusBadge status={item.licenceStatus} />}
                        </div>
                      </div>

                      {requiresManualReview ? (
                        <div className="rounded-2xl border border-warning/25 bg-paper px-4 py-4">
                          <p className="text-xs font-black uppercase text-warning">Manual review required</p>
                          <p className="mt-2 text-sm font-bold leading-relaxed text-ink/70">
                            {isUnknownRegistry
                              ? "This licensing body is not included in PaRx yet. Review this prescriber manually using the source registry outside the app."
                              : "This registry does not support automated verification in PaRx yet. Open the official directory and review this prescriber manually."}
                          </p>
                          {item.licenceNumber && (
                            <p className="mt-3 text-sm font-black text-ink">Licence number: {item.licenceNumber}</p>
                          )}
                        </div>
                      ) : (
                        <dl className="grid gap-3 sm:grid-cols-2">
                          <DetailBlock label="Matched name" value={item.matchedName} />
                          <DetailBlock label="Licence number" value={item.resultLicenceNumber} />
                          <DetailBlock label="Current status" value={item.licenceStatus} />
                          <DetailBlock label="Registration class" value={item.licenceClass} />
                        </dl>
                      )}

                      {item.notes && (
                        <p className="text-sm font-bold text-ink/60">{item.notes}</p>
                      )}

                      {item.institution === "cpsbc" && item.lastName && item.outcome !== "not_found" && (
                        <div className="flex flex-wrap gap-3">
                          <button
                            type="button"
                            onClick={() =>
                              void downloadCpsbcPdf(cpsbcResultItem, item.rowNumber, {
                                lastName: item.lastName,
                                firstName: item.firstName,
                              })
                            }
                            disabled={downloadingPdfKey === bulkItemKey}
                            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-black text-white transition hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                          >
                            {downloadingPdfKey === bulkItemKey && <Spinner />}
                            {downloadingPdfKey === bulkItemKey ? "Downloading PDF..." : "Download CPSBC result PDF"}
                            {downloadingPdfKey !== bulkItemKey && <DownloadIcon />}
                          </button>
                          <a
                            href="https://www.cpsbc.ca/directory"
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-line bg-field px-4 py-2.5 text-center text-sm font-black text-ink transition hover:border-accent/50 hover:bg-accent-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 sm:w-auto"
                          >
                            Open CPSBC directory page
                            <span aria-hidden="true">↗</span>
                          </a>
                        </div>
                      )}

                      {actionUrl && !(item.institution === "cpsbc" && item.outcome !== "not_found") && (
                        <a
                          href={actionUrl}
                          target="_blank"
                          rel="noreferrer"
                          className={`inline-flex w-full items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-center text-sm font-black transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 sm:w-auto ${
                            requiresManualReview
                              ? "bg-warning text-white hover:bg-warning/90"
                              : "bg-accent text-white hover:bg-accent/90"
                          }`}
                        >
                          {bulkActionLabel(item)}
                          <span aria-hidden="true">↗</span>
                        </a>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          )}

          {result && (
            <div aria-live="polite" className="space-y-4 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-2">
              <div className={`space-y-2 rounded-2xl border px-4 py-4 sm:rounded-[30px] sm:px-6 sm:py-5 ${outcomeMeta?.panel}`}>
                <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black uppercase ${outcomeMeta?.badge}`}>
                  {outcomeMeta?.label}
                </span>
                {result.notes && (
                  <p className={`text-sm font-bold ${isErrorOutcome ? "text-danger" : "text-ink/65"}`}>
                    {result.notes}
                  </p>
                )}
                {result.outcome === "not_found" && (
                  <a
                    href={institutionConfig.baseUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-center text-sm font-black text-white transition hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 sm:w-auto"
                  >
                    Open directory search page
                    <span aria-hidden="true">↗</span>
                  </a>
                )}
              </div>

              {result.results && result.results.length > 0 && (
                <div className="space-y-4">
                  {result.results.map((item, index) => {
                    const recordLabel =
                      institutionConfig.label === "CPSO" && item.cpsoNumber
                        ? `CPSO #: ${item.cpsoNumber}`
                        : item.registrationNumber
                          ? `Registration #: ${item.registrationNumber}`
                          : `${institutionConfig.label} directory record`;

                    const statusLabel =
                      institutionConfig.label === "CPSO" || institutionConfig.label === "CPSA"
                        ? "Member status"
                        : "Licence status";
                    const classLabel =
                      institutionConfig.label === "CPSO"
                        ? "Registration class"
                        : institutionConfig.label === "CPSA"
                          ? "Register class"
                          : "Licence class";
                    const practiceLabel =
                      institutionConfig.label === "CPSO"
                        ? "Practice details"
                        : institutionConfig.label === "CPSA"
                          ? "Practice discipline"
                          : "Practice type";
                    const hidePractice = institutionConfig.label === "CPSO" && !item.practiceType;
                    const itemKey = `${item.fullName}-${index}`;

                    return (
                      <article
                        key={`${item.fullName}-${index}`}
                        className="min-w-0 space-y-4 rounded-2xl border border-ink/10 bg-surface p-4 sm:rounded-[30px] sm:p-5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="font-heading break-words text-xl font-black text-ink sm:text-2xl">{item.fullName}</h3>
                            <p className="mt-1 break-words text-sm font-bold text-ink/55">{recordLabel}</p>
                          </div>
                          <StatusBadge status={item.licenceStatus} />
                        </div>

                        <dl className={`grid gap-3 ${hidePractice ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
                          <DetailBlock label={statusLabel} value={item.licenceStatus} />
                          <DetailBlock label={classLabel} value={item.licenceClass} />
                          {!hidePractice && <DetailBlock label={practiceLabel} value={item.practiceType} />}
                        </dl>

                        {item.profileUrl && institutionConfig.key === "cpsbc" && (
                          <div className="flex flex-wrap gap-3">
                            <button
                              type="button"
                              onClick={() => void downloadCpsbcPdf(item, index)}
                              disabled={downloadingPdfKey === itemKey}
                              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-sm font-black text-white transition hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                            >
                              {downloadingPdfKey === itemKey && <Spinner />}
                              {downloadingPdfKey === itemKey ? "Downloading PDF..." : "Download CPSBC result PDF"}
                              {downloadingPdfKey !== itemKey && <DownloadIcon />}
                            </button>
                            <a
                              href="https://www.cpsbc.ca/directory"
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-line bg-field px-4 py-2.5 text-center text-sm font-black text-ink transition hover:border-accent/50 hover:bg-accent-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 sm:w-auto"
                            >
                              Open CPSBC directory page
                              <span aria-hidden="true">↗</span>
                            </a>
                          </div>
                        )}

                        {item.profileUrl && institutionConfig.key !== "cpsbc" && (
                          <a
                            href={item.profileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-accent px-4 py-2.5 text-center text-sm font-black text-white transition hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 sm:w-auto"
                          >
                            {institutionConfig.key === "cpsm"
                              ? "Open directory search page"
                              : `Open ${institutionConfig.label} result page`}
                            <span aria-hidden="true">↗</span>
                          </a>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
