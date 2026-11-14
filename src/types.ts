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
}
export interface Edge {
  source: string;
  target: string;
}
export interface Card {
  id: string;
  source: string;
  subject: Subject;
  question: string;
  answer: string;
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
  notes: Note[];
  links: WikiLink[];
  edges: Edge[];
  cards: Card[];
  history: { schema_version: number; cards: Record<string, Review> };
  warnings: string[];
  review_error: string | null;
}
export type Rating = "again" | "hard" | "good" | "easy";
export function message(e: unknown): string {
  return typeof e === "object" && e && "message" in e
    ? String(e.message)
    : String(e);
}
