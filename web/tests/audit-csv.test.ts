import { describe, expect, it } from "vitest";
import { type AuditCsvRow, auditLogsToCsv, auditRangeSince } from "@/components/Settings/auditCsv";

describe("audit CSV export", () => {
  const rows: AuditCsvRow[] = [
    {
      id: 1,
      createdAt: "2026-01-01T00:00:00Z",
      actorUsername: "alice",
      action: "auth.sign_in",
      procedure: "/memos.api.v1.AuthService/SignIn",
      clientIp: "203.0.113.10",
      outcome: "success",
    },
    {
      id: 2,
      createdAt: "2026-01-02T00:00:00Z",
      actorUsername: 'evil,"bob"',
      action: "user.delete",
      procedure: "line\nbreak",
      clientIp: "",
      outcome: "denied",
    },
  ];

  it("emits a header plus one line per simple row", () => {
    const csv = auditLogsToCsv([rows[0]]);
    const lines = csv.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("id,created_at,actor,action,procedure,ip,outcome");
    expect(lines[1]).toContain("alice");
    expect(lines[1]).toContain("auth.sign_in");
  });

  it("includes every row on the page", () => {
    const csv = auditLogsToCsv(rows);
    expect(csv).toContain("auth.sign_in");
    expect(csv).toContain("user.delete");
  });

  it("escapes quotes, commas, and newlines", () => {
    const csv = auditLogsToCsv(rows);
    expect(csv).toContain('"evil,""bob"""');
    expect(csv).toContain('"line\nbreak"');
  });

  it("returns only the header for an empty page", () => {
    expect(auditLogsToCsv([])).toBe("id,created_at,actor,action,procedure,ip,outcome\n");
  });
});

describe("audit time range", () => {
  it("returns undefined for all-time", () => {
    expect(auditRangeSince("all")).toBeUndefined();
  });

  it("maps today to local midnight", () => {
    const now = new Date(2026, 0, 15, 14, 30, 0).getTime();
    const since = auditRangeSince("today", now);
    expect(since).toBe(Math.floor(new Date(2026, 0, 15, 0, 0, 0, 0).getTime() / 1000));
  });

  it("maps 7d to a rolling week window", () => {
    const now = 1_700_000_000_000;
    const since = auditRangeSince("7d", now);
    expect(since).toBe(Math.floor((now - 7 * 24 * 60 * 60 * 1000) / 1000));
  });
});
