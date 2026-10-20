import { afterEach, describe, expect, it, vi } from "vitest";
import { requestTimeLimitMs } from "@/lib/server/timeLimit";

afterEach(() => vi.unstubAllEnvs());

describe("how long a request may run", () => {
  it("stays under Vercel's 60-second cut-off unless it is raised", () => {
    vi.stubEnv("REQUEST_TIME_LIMIT_SEC", "");
    expect(requestTimeLimitMs()).toBe(55_000);
    vi.stubEnv("REQUEST_TIME_LIMIT_SEC", "170");
    expect(requestTimeLimitMs()).toBe(170_000);
  });

  it("ignores values that make no sense and caps very long ones", () => {
    for (const value of ["abc", "0", "5", "-30"]) {
      vi.stubEnv("REQUEST_TIME_LIMIT_SEC", value);
      expect(requestTimeLimitMs()).toBe(55_000);
    }
    vi.stubEnv("REQUEST_TIME_LIMIT_SEC", "5000");
    expect(requestTimeLimitMs()).toBe(800_000);
  });
});
