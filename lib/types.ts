export const SECTIONS = ["sooz", "personal"] as const;
export type Section = (typeof SECTIONS)[number];

export const STATUSES = ["new", "seen", "saved", "contacted", "dismissed"] as const;
export type Status = (typeof STATUSES)[number];

export const SOOZ_KINDS = ["angel", "event", "funding", "resource"] as const;
export const PERSONAL_KINDS = [
  "hackathon",
  "leadership",
  "culture",
  "job",
  "grant",
  "event",
  "other",
] as const;

export const KINDS: Record<Section, readonly string[]> = {
  sooz: SOOZ_KINDS,
  personal: PERSONAL_KINDS,
};

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
