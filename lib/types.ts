export const SECTIONS = ["sooz", "personal", "career"] as const;
export type Section = (typeof SECTIONS)[number];

export const STATUSES = ["new", "seen", "saved", "contacted", "dismissed"] as const;
export type Status = (typeof STATUSES)[number];

/** Kinds that are people (one person per item): identified by name + firm, and eligible for outreach. */
export const PERSON_KINDS = ["angel", "celebrity", "nextgen", "creator", "buyer", "media"] as const;
export type PersonKind = (typeof PERSON_KINDS)[number];
export const isPersonKind = (k: string): k is PersonKind => (PERSON_KINDS as readonly string[]).includes(k);

export const SOOZ_KINDS = [...PERSON_KINDS, "event", "sampling", "funding", "resource"] as const;
export const PERSONAL_KINDS = [
  "hackathon",
  "event",
  "talk",
  "pass",
  "speaking",
  "perk",
  "grant",
  "leadership",
  "culture",
  "other",
] as const;
export const CAREER_KINDS = ["internship", "externship", "program", "fellowship", "scholarship", "job"] as const;

export const KINDS: Record<Section, readonly string[]> = {
  sooz: SOOZ_KINDS,
  personal: PERSONAL_KINDS,
  career: CAREER_KINDS,
};

/** Why we are reaching out to a person. Drives the draft template. */
export const PURPOSES = ["invest", "ambassador", "buyer", "press", "intro"] as const;
export type Purpose = (typeof PURPOSES)[number];
export const isPurpose = (p: string): p is Purpose => (PURPOSES as readonly string[]).includes(p);

export function defaultPurpose(kind: string): Purpose {
  switch (kind) {
    case "celebrity":
    case "creator":
      return "ambassador";
    case "buyer":
      return "buyer";
    case "media":
      return "press";
    default:
      return "invest";
  }
}

export interface ItemDetails {
  firm?: string | null;
  role?: string | null;
  rice_connection?: string | null;
  check_size?: string | null;
  contact_path?: string | null;
}

export interface Item {
  id: number;
  section: Section;
  kind: string;
  title: string;
  url: string | null;
  source: string | null;
  summary: string;
  why_relevant: string;
  score: number;
  tags: string[];
  details: ItemDetails;
  event_date: string | null;
  deadline: string | null;
  location: string | null;
  status: Status;
  notes: string;
  first_seen: string;
  last_seen: string;
}

/** A finding as produced by the research agent, before persistence. */
export interface Candidate {
  kind: string;
  title: string;
  url: string;
  source?: string | null;
  summary: string;
  why_relevant: string;
  score: number;
  tags: string[];
  details: ItemDetails;
  event_date?: string | null;
  deadline?: string | null;
  location?: string | null;
}
