/**
 * Pure CSV helpers for the audit log table. Kept free of React so they can be
 * unit-tested and reused by a future export handler.
 */

export type AuditCsvRow = {
  id: number;
  createdAt: string;
  actorUsername: string;
  action: string;
  procedure: string;
  clientIp: string;
  outcome: string;
};

const escapeCsvField = (value: string): string => {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

/** Builds a CSV document from the currently visible audit rows. */
export const auditLogsToCsv = (rows: readonly AuditCsvRow[]): string => {
  const header = ["id", "created_at", "actor", "action", "procedure", "ip", "outcome"];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        String(row.id),
        escapeCsvField(row.createdAt),
        escapeCsvField(row.actorUsername || ""),
        escapeCsvField(row.action || ""),
        escapeCsvField(row.procedure || ""),
        escapeCsvField(row.clientIp || ""),
        escapeCsvField(row.outcome || ""),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
};

/** Triggers a browser download of the CSV payload. No-op outside a DOM. */
export const downloadAuditCsv = (csv: string, filename = "audit-logs.csv"): void => {
  if (typeof document === "undefined") return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export type AuditTimeRange = "today" | "7d" | "all";

/** Converts a UI range into a unix-seconds `since` filter, or undefined for all. */
export const auditRangeSince = (range: AuditTimeRange, now = Date.now()): number | undefined => {
  if (range === "all") return undefined;
  const date = new Date(now);
  if (range === "today") {
    date.setHours(0, 0, 0, 0);
    return Math.floor(date.getTime() / 1000);
  }
  // 7d: rolling window from now.
  return Math.floor((now - 7 * 24 * 60 * 60 * 1000) / 1000);
};
