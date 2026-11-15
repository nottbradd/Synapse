export type Subject =
  "specialist" | "methods" | "physics" | "english-language" | "general";
export const subjects: {
  id: Subject;
  name: string;
  short: string;
  color: string;
}[] = [
  {
    id: "specialist",
    name: "Specialist Mathematics",
    short: "Specialist",
    color: "#a855f7",
  },
  {
    id: "methods",
    name: "Mathematical Methods",
    short: "Methods",
    color: "#3b82f6",
  },
  { id: "physics", name: "Physics", short: "Physics", color: "#10b981" },
  {
    id: "english-language",
    name: "English Language",
    short: "English Language",
    color: "#f59e0b",
  },
  {
    id: "general",
    name: "General / Unassigned",
    short: "General",
    color: "#64748b",
  },
];
export interface Note {
  id: string;
  title: string;
  subject: Subject;
  subject_id: string;
  neuron_id: string;
  revision: string;
  neighbors: number;
}
export interface Document {
  id: string;
  content: string;
  revision: string;
}
export interface WikiLink {
  source: string;
  raw: string;
  target: string | null;
  candidates: string[];
  external: boolean;
}
export interface Edge {
  source: string;
  target: string;
}
export interface Card {
  id: string;
  content_id: string;
  subject_id: string;
  neuron_id: string;
  source: string;
  subject: Subject;
  question: string;
  answer: string;
}
export interface RecallBlock {
  content_id: string;
  question: string;
  answer: string;
  start: number;
  end: number;
}
export interface NotePresentation {
  body: string;
  recalls: RecallBlock[];
}
export interface RatingPreviews {
  card_id: string;
  reference_time: number;
  options: { rating: Rating; due: number; interval_seconds: number }[];
}
export interface Review {
  card_id: string;
  last_review: number;
  due: number;
  interval: number;
  ease: number;
  reviews: number;
  lapses: number;
}
export interface Snapshot {
  root: string;
  name: string;
  organization: Organization;
  notes: Note[];
  links: WikiLink[];
  edges: Edge[];
  cards: Card[];
  history: { schema_version: number; cards: Record<string, Review> };
  warnings: string[];
  review_error: string | null;
}
export interface Location {
  neuron_id: string | null;
  subject_id: string | null;
}
export interface Neuron {
  id: string;
  name: string;
  path: string;
}
export interface SubjectRecord {
  id: string;
  neuron_id: string;
  name: string;
  color: string;
  preset: Subject;
  root: string | null;
  legacy: boolean;
}
export interface Organization {
  schema_version: number;
  neurons: Neuron[];
  subjects: SubjectRecord[];
  location: Location;
  fallback_subject: string;
}
export interface ImportPreview {
  token: string;
  name: string;
  color: string;
  notes: number;
  attachments: number;
  bytes: number;
  external_references: string[];
  external_count: number;
  has_history: boolean;
}
export type OrganizationAction =
  | { kind: "new_neuron"; name: string }
  | {
      kind: "new_subject";
      name: string;
      neuron_id: string;
      preset: Subject;
      color: string;
    }
  | { kind: "rename"; id: string; name: string }
  | { kind: "assign"; subject_id: string; neuron_id: string }
  | { kind: "select"; location: Location };
export function inLocation(
  item: { subject_id: string; neuron_id: string },
  location: Location,
) {
  return location.subject_id
    ? item.subject_id === location.subject_id
    : !location.neuron_id || item.neuron_id === location.neuron_id;
}
export type Rating = "again" | "hard" | "good" | "easy";
export function message(e: unknown): string {
  return typeof e === "object" && e && "message" in e
    ? String(e.message)
    : String(e);
}
