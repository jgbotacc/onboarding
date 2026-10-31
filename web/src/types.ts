export type Status =
  | "registering"
  | "missing_info"
  | "generating"
  | "awaiting_review"
  | "accepted"
  | "handed_off";

export interface ApiResponse {
  reply: string;
  images: string[];
  status: Status | string;
  missing: string[];
  round: number;
}

export const MAX_ROUNDS = 3;

export const STATUS_LABELS: Record<string, string> = {
  registering: "Registering",
  missing_info: "Missing info",
  generating: "Generating",
  awaiting_review: "Awaiting review",
  accepted: "Accepted",
  handed_off: "Handed off",
};
