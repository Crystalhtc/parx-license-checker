export type InstitutionKey =
  | "cpsbc"
  | "cpso"
  | "cpsa"
  | "cpssk"
  | "cpsm"
  | "cmq"
  | "cpsns"
  | "cpsnb"
  | "cpspei"
  | "cpsnl";

export type InstitutionConfig = {
  key: InstitutionKey;
  label: string;
  baseUrl: string;
  searchInputSelector: string;
  submitSelector: string;
  resultSelector: string;
  resultPagePattern: string;
  searchPlaceholder: string;
};

const institutionConfigs: Record<InstitutionKey, InstitutionConfig> = {
  cpsbc: {
    key: "cpsbc",
    label: "CPSBC",
    baseUrl: "https://www.cpsbc.ca/directory",
    searchInputSelector: 'input[name="ps_last_name"], input[name="ps_city"], input[name="city"], input[name="last_name"]',
    submitSelector: "#edit-ps-submit",
    resultSelector: ".result-item",
    resultPagePattern: "/directory/search-result",
    searchPlaceholder: "Last name",
  },
  cpso: {
    key: "cpso",
    label: "CPSO",
    baseUrl: "https://register.cpso.on.ca/",
    searchInputSelector: '#searchForm input[name="cpsoNumber"], #searchForm #cpsoId',
    submitSelector: '#searchForm button[type="submit"]',
    resultSelector: "#physicianTable tbody tr",
    resultPagePattern: "/physician-info/",
    searchPlaceholder: "CPSO #",
  },
  cpsa: {
    key: "cpsa",
    label: "CPSA",
    baseUrl: "https://search.cpsa.ca/",
    searchInputSelector: '[role="searchbox"][aria-label*="Last Name"]',
    submitSelector: 'button:has-text("Search")',
    resultSelector: "#MainContent_physicianSearchView_gvResults tr",
    resultPagePattern: "/PhysicianProfile",
    searchPlaceholder: "Last name",
  },
  cpssk: {
    key: "cpssk",
    label: "CPSS",
    baseUrl: "https://www.cps.sk.ca/",
    searchInputSelector: 'input[name*="last" i], input[aria-label*="Last" i]',
    submitSelector: 'button:has-text("Search"), input[type="submit"]',
    resultSelector: "table tbody tr, .search-result, .result-item",
    resultPagePattern: "/imis/",
    searchPlaceholder: "Last name",
  },
  cpsm: {
    key: "cpsm",
    label: "CPSM",
    baseUrl: "https://member.cpsm.mb.ca/member/profilesearch",
    searchInputSelector: "input.form-control",
    submitSelector: 'button:has-text("Search")',
    resultSelector: ".listingCore tbody tr",
    resultPagePattern: "/member/profile",
    searchPlaceholder: "Last name",
  },
  cmq: {
    key: "cmq",
    label: "CMQ",
    baseUrl: "https://form.cmq.org/fr/bottin?search=physician",
    searchInputSelector: 'input[name="query"]',
    submitSelector: 'button[aria-label*="Rechercher" i], button[type="submit"]',
    resultSelector: "article, .search-result, table tbody tr",
    resultPagePattern: "/fr/bottin",
    searchPlaceholder: "Last name or licence number",
  },
  cpsns: {
    key: "cpsns",
    label: "CPSNS",
    baseUrl: "https://cpsnsphysiciansearch.azurewebsites.net/",
    searchInputSelector: "#lastname",
    submitSelector: "#search",
    resultSelector: "table tbody tr",
    resultPagePattern: "SearchResults.aspx",
    searchPlaceholder: "Licence number",
  },
  cpsnb: {
    key: "cpsnb",
    label: "CPSNB",
    baseUrl: "https://cpsnb.alinityapp.com/Client/PublicDirectory",
    searchInputSelector: 'input[name="last name"]',
    submitSelector: 'button[name="Search"]',
    resultSelector: "table tbody tr",
    resultPagePattern: "medical-directory",
    searchPlaceholder: "Last name",
  },
  cpspei: {
    key: "cpspei",
    label: "CPSPEI",
    baseUrl: "https://cpspei.alinityapp.com/client/publicdirectory",
    searchInputSelector: "#ParameterForm1000608_TextOptionC",
    submitSelector: ".als-search-button",
    resultSelector: "table tbody tr",
    resultPagePattern: "publicdirectory",
    searchPlaceholder: "Licence number",
  },
  cpsnl: {
    key: "cpsnl",
    label: "CPSNL",
    baseUrl: "https://cpsnl.alinityapp.com/client/publicdirectory",
    searchInputSelector: "#ParameterForm1000608_TextOptionC",
    submitSelector: ".als-search-button",
    resultSelector: "table tbody tr",
    resultPagePattern: "publicdirectory",
    searchPlaceholder: "Licence number",
  },
};

export function normalizeInstitution(value?: string | null): InstitutionKey {
  if (
    value === "cpsbc" ||
    value === "cpso" ||
    value === "cpsa" ||
    value === "cpssk" ||
    value === "cpsm" ||
    value === "cmq" ||
    value === "cpsns" ||
    value === "cpsnb" ||
    value === "cpspei" ||
    value === "cpsnl"
  ) {
    return value;
  }
  return "cpsbc";
}

export function resolveInstitutionConfig(value?: string | null): InstitutionConfig {
  return institutionConfigs[normalizeInstitution(value)];
}
