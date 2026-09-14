import { useQuery } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { getAccessToken } from "@/auth-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import useCurrentUser from "@/hooks/useCurrentUser";
import { useTranslate } from "@/utils/i18n";
import { isSuperUser } from "@/utils/user";
import SettingGroup from "./SettingGroup";
import { SettingPanel } from "./SettingList";
import SettingSection from "./SettingSection";

type AuditLogEntry = {
  id: number;
  createdAt: string;
  actorUserId: number;
  actorUsername: string;
  action: string;
  procedure: string;
  clientIp: string;
  outcome: string;
  detail?: unknown;
};

type AuditLogsResponse = {
  logs: AuditLogEntry[];
};

const OUTCOME_FILTERS = ["", "success", "denied", "error"] as const;

const auditLogsQueryKey = (params: { action: string; outcome: string; username: string }) => ["audit-logs", params] as const;

const fetchAuditLogs = async (params: { action: string; outcome: string; username: string }): Promise<AuditLogsResponse> => {
  const search = new URLSearchParams();
  search.set("limit", "100");
  if (params.action) search.set("action", params.action);
  if (params.outcome) search.set("outcome", params.outcome);
  if (params.username) search.set("username", params.username);
  const token = getAccessToken();
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`/api/v1/audit-logs?${search.toString()}`, {
    credentials: "include",
    headers,
  });
  if (!response.ok) {
    throw new Error(`audit logs request failed: ${response.status}`);
  }
  return (await response.json()) as AuditLogsResponse;
};

const formatTimestamp = (value: string): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

/**
 * Admin-only audit trail browser backed by GET /api/v1/audit-logs.
 * Visible only when the signed-in user holds the instance admin role.
 */
const AuditLogSection = () => {
  const t = useTranslate();
  const currentUser = useCurrentUser();
  const isAdmin = Boolean(isSuperUser(currentUser));

  const [action, setAction] = useState("");
  const [outcome, setOutcome] = useState<string>(OUTCOME_FILTERS[0]);
  const [username, setUsername] = useState("");
  const [appliedUsername, setAppliedUsername] = useState("");

  const params = useMemo(
    () => ({
      action: action.trim(),
      outcome,
      username: appliedUsername.trim(),
    }),
    [action, outcome, appliedUsername],
  );

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: auditLogsQueryKey(params),
    queryFn: () => fetchAuditLogs(params),
    enabled: isAdmin,
    staleTime: 15_000,
  });

  if (!isAdmin) {
    return null;
  }

  return (
    <SettingSection
      title={t("setting.audit-logs.title")}
      description={t("setting.audit-logs.description")}
      actions={
        <Button variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>
          <RefreshCwIcon className="mr-1 size-4" />
          {t("setting.audit-logs.refresh")}
        </Button>
      }
    >
      <SettingGroup title={t("setting.audit-logs.filters")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder={t("setting.audit-logs.action-placeholder")}
            className="sm:max-w-xs"
          />
          <Select value={outcome} onValueChange={setOutcome}>
            <SelectTrigger className="sm:w-40">
              <SelectValue placeholder={t("setting.audit-logs.outcome")} />
            </SelectTrigger>
            <SelectContent>
              {OUTCOME_FILTERS.map((value) => (
                <SelectItem key={value || "all"} value={value}>
                  {value === "" ? t("setting.audit-logs.outcome-all") : value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") setAppliedUsername(username);
              }}
              placeholder={t("setting.audit-logs.username-placeholder")}
              className="sm:max-w-xs"
            />
            <Button variant="secondary" size="sm" onClick={() => setAppliedUsername(username)}>
              {t("setting.audit-logs.apply")}
            </Button>
          </div>
        </div>
      </SettingGroup>

      {isError ? <div className="text-destructive text-sm">{t("setting.audit-logs.load-error")}</div> : null}

      {isLoading && !data ? (
        <SettingPanel>
          <div className="px-3 py-3 text-sm text-muted-foreground">…</div>
        </SettingPanel>
      ) : null}

      {data ? (
        <SettingGroup title={t("setting.audit-logs.results", { count: String(data.logs.length) })} showSeparator>
          {data.logs.length === 0 ? (
            <SettingPanel>
              <div className="px-3 py-3 text-sm text-muted-foreground">{t("setting.audit-logs.empty")}</div>
            </SettingPanel>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border/70">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t("setting.audit-logs.column-time")}</th>
                    <th className="px-3 py-2 font-medium">{t("setting.audit-logs.column-actor")}</th>
                    <th className="px-3 py-2 font-medium">{t("setting.audit-logs.column-action")}</th>
                    <th className="px-3 py-2 font-medium">{t("setting.audit-logs.column-ip")}</th>
                    <th className="px-3 py-2 font-medium">{t("setting.audit-logs.column-outcome")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.logs.map((log) => (
                    <tr key={log.id} className="border-t border-border/60">
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{formatTimestamp(log.createdAt)}</td>
                      <td className="px-3 py-2">{log.actorUsername || "—"}</td>
                      <td className="px-3 py-2 font-mono text-xs">{log.action}</td>
                      <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{log.clientIp || "—"}</td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            log.outcome === "success"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : log.outcome === "denied"
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-destructive"
                          }
                        >
                          {log.outcome}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SettingGroup>
      ) : null}
    </SettingSection>
  );
};

export default AuditLogSection;
