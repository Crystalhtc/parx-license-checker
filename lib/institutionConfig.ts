export type InstitutionKey = "cpsbc" | "cpso" | "cpsa";

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
};

export function normalizeInstitution(value?: string | null): InstitutionKey {
  if (value === "cpso") {
    return "cpso";
  }
  if (value === "cpsa") {
    return "cpsa";
  }
  return "cpsbc";
}

export function resolveInstitutionConfig(value?: string | null): InstitutionConfig {
  return institutionConfigs[normalizeInstitution(value)];
}
