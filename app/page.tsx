"use client";

import { useState } from "react";
import { resolveInstitutionConfig, type InstitutionKey } from "@/lib/institutionConfig";

const INSTITUTIONS: InstitutionKey[] = ["cpsbc", "cpso", "cpsa"];

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
  notes?: string;
  results?: ResultItem[];
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
  return normalized === "practising" || normalized === "active";
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
    normalized.includes("expired")
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
      className={`relative flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition ${
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

export default function Home() {
  const [mobileStep, setMobileStep] = useState<1 | 2 | 3>(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [firstName, setFirstName] = useState("");
  const [institutionQuery, setInstitutionQuery] = useState("");
  const [institution, setInstitution] = useState<InstitutionKey>("cpsbc");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloadingPdfKey, setDownloadingPdfKey] = useState<string | null>(null);
  const [submittedSearchTerm, setSubmittedSearchTerm] = useState("");
  const [submittedFirstName, setSubmittedFirstName] = useState("");

  const institutionConfig = resolveInstitutionConfig(institution);
  const institutionMeta = INSTITUTION_META[institution];
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
    const submittedGivenName = institution === "cpsbc" || institution === "cpsa" ? firstName.trim() : "";

    setMobileStep(3);
    setLoading(true);
    setResult(null);
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
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!searchTerm.trim() || loading) return;
    void checkRegistry();
  }

  async function downloadCpsbcPdf(item: ResultItem, index: number) {
    if (!item.profileUrl) return;

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
          searchTerm: submittedSearchTerm || searchTerm.trim(),
          firstName: submittedFirstName || firstName.trim(),
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

              <div className="mt-6 space-y-3 lg:h-[clamp(220px,30vh,320px)] lg:overflow-y-auto lg:pr-1">
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
                <div
                  role="radiogroup"
                  aria-label="Institution"
                  className="grid gap-3"
                >
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
                        setMobileStep(1);
                      }}
                    />
                  ))}
                </div>
                {filteredInstitutions.length === 0 && (
                  <p className="rounded-2xl border border-dashed border-line bg-surface px-4 py-3 text-sm font-bold text-ink/55">
                    No institutions match that search.
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => setMobileStep(2)}
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-black text-white transition hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 lg:hidden"
                >
                  Continue
                </button>
              </div>
            </div>

            <div className={`${mobileStep === 2 ? "block" : "hidden"} space-y-5 lg:block lg:shrink-0 lg:border-t lg:border-ink/12 lg:bg-paper lg:pt-5`}>
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
              <div className="rounded-2xl border border-line bg-surface px-4 py-4 lg:hidden">
                <p className="text-xs font-black uppercase text-ink/50">Selected registry</p>
                <h2 className="mt-1 text-base font-black leading-snug text-ink">{institutionMeta.fullName}</h2>
                <p className="mt-1 text-sm font-bold text-ink/55">{institutionMeta.province}</p>
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

              {(institution === "cpsbc" || institution === "cpsa") && (
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
                disabled={loading || !searchTerm.trim()}
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
                {result
                  ? resultCount === 1
                    ? "1 record returned"
                    : `${resultCount} records returned`
                  : "Ready to search"}
              </h2>
            </div>
            <span className="rounded-full border border-line bg-surface px-4 py-2 text-xs font-black uppercase text-ink/70">
              {institutionConfig.label}
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
                setMobileStep(1);
              }}
              className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-accent px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-accent/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
            >
              New Search
            </button>
          </div>

          {!result && (
            <div className="flex min-h-[220px] items-center justify-center rounded-2xl border border-dashed border-line bg-surface px-6 py-6 sm:min-h-[380px] sm:rounded-[30px] lg:flex-1">
              <p className="text-base font-black text-ink/55">{loading ? "Checking..." : "No search run yet"}</p>
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
              </div>

              {result.results && result.results.length > 0 && (
                <div className="space-y-4">
                  {result.results.map((item, index) => {
                    const recordLabel =
                      institutionConfig.label === "CPSO" && item.cpsoNumber
                        ? `CPSO #: ${item.cpsoNumber}`
                        : institutionConfig.label === "CPSA" && item.registrationNumber
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
                            Open {institutionConfig.label} result page
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
