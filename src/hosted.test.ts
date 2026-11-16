import { describe, expect, it } from "vitest";
import { hostedMessage, resetTime } from "./hosted";

describe("hosted allowance presentation", () => {
  it("distinguishes personal allowance, shared budget and service availability", () => {
    expect(hostedMessage("daily_allowance")).toContain("Your daily allowance");
    expect(hostedMessage("shared_budget")).toContain("shared service budget");
    expect(hostedMessage("service_paused")).toContain("paused by the owner");
    expect(hostedMessage("service_unavailable")).toContain("offline");
    expect(hostedMessage(null)).toBe("");
  });
  it("renders the server reset in the chosen timezone across daylight saving", () => {
    const at = Date.UTC(2026, 10, 16) / 1000;
    expect(resetTime(at, "Australia/Sydney")).toMatch(/11:00/);
    expect(resetTime(at, "UTC")).toMatch(/12:00|00:00/);
    expect(resetTime(at, "America/New_York")).toMatch(/15/);
  });
});
