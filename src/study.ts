import type { Location } from "./types";
export type StudyKind = "quiz" | "flashcards" | "reminder";
export interface SourceRef {
  external?: boolean;
  id: string;
  title: string;
  revision: string;
  subject_id: string;
}
export interface SourceContent extends SourceRef {
  content: string;
}
export interface StudyContext {
  token: string;
  location: Location;
  kind: StudyKind;
  sources: SourceContent[];
  excluded: { id: string; reason: string }[];
  bytes: number;
  prepared_at: number;
}
export interface Question {
  id: string;
  kind: "multiple_choice" | "short_answer";
  prompt: string;
  options: string[];
  correct_index: number | null;
  answer: string;
  explanation: string;
  sources: string[];
}
export interface QuizDraft {
  title: string;
  questions: Question[];
}
export interface CardDraft {
  question: string;
  answer: string;
  sources: string[];
}
export interface FlashcardDraft {
  title: string;
  cards: CardDraft[];
}
export interface ReminderDraft {
  title: string;
  local_at: string;
  timezone: string;
  repetition: "none" | "daily" | "weekly";
  source_id: string | null;
  subject_id: string | null;
  fold: "earlier" | "later" | null;
  clarification: string | null;
}
export type StudyDraft =
  | { kind: "quiz"; data: QuizDraft }
  | { kind: "flashcards"; data: FlashcardDraft }
  | { kind: "reminder"; data: ReminderDraft };
export interface Generated {
  request_id: string;
  draft: StudyDraft;
  input_tokens: number;
  output_tokens: number;
  reference_time: number;
  usage_warning: string | null;
}
export interface Quiz {
  id: string;
  subject_id: string;
  created_at: number;
  draft: QuizDraft;
  sources: SourceRef[];
}
export interface Answer {
  question_id: string;
  option: number | null;
  response: string;
  self_assessed: boolean | null;
}
export interface Attempt {
  id: string;
  quiz_id: string;
  completed_at: number;
  answers: Answer[];
  correct: number;
  total: number;
}
export interface Reminder {
  id: string;
  draft: ReminderDraft;
  enabled: boolean;
  next_due: number | null;
  pending_due: number | null;
  last_delivered: number | null;
  created_at: number;
}
export interface StudyView {
  data: {
    schema_version: number;
    quizzes: Quiz[];
    attempts: Attempt[];
    reminders: Reminder[];
  };
  revision: string | null;
}
export interface DeviceSettings {
  test_api: boolean;
  provider: "synapse" | "personal";
  hosted_consent: boolean;
  hosted_configured: boolean;
  hosted_connected: boolean;
  model: string;
  models: string[];
  max_output_tokens: number;
  timezone: string;
  background: boolean;
  key_present: boolean;
  usage: {
    requests: number;
    input_tokens: number;
    output_tokens: number;
    last_request_at: number | null;
  };
  error: string | null;
}
export interface HostedStatus {
  member: string;
  device: string;
  server_time: number;
  reason: string | null;
  remaining: number;
  daily_limit: number;
  reset_at: number;
  retry_at: number | null;
  requests: number;
  input_tokens: number;
  output_tokens: number;
  estimated_nusd: number;
  reserved_nusd: number;
  active: boolean;
  model: string;
}
export interface ResolvedReminder {
  due: number;
  display: string;
  reference_time: number;
}
export function localDateTime(
  timezone: string,
  timestamp = Date.now() + 3_600_000,
) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(timestamp);
  const part = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
export function blankQuestion(sources: string[]): Question {
  return {
    id: crypto.randomUUID(),
    kind: "multiple_choice",
    prompt: "",
    options: ["", "", "", ""],
    correct_index: 0,
    answer: "",
    explanation: "",
    sources,
  };
}
