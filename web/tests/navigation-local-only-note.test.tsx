import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import NavigationPage from "@/modules/navigation/NavigationPage";
import { createSeedConfig } from "@/modules/navigation/types";

const nav = vi.hoisted(() => ({
  state: null as null | {
    config: ReturnType<typeof createSeedConfig>;
    memoName: string | null;
    source: string;
    memoSync: string;
  },
}));

vi.mock("@/connect", () => ({
  memoServiceClient: {
    listMemos: vi.fn(),
    createMemo: vi.fn(),
    updateMemo: vi.fn(),
    deleteMemo: vi.fn(),
  },
}));

vi.mock("@/modules/navigation/useNavConfig", () => ({
  useNavConfig: () => ({
    state: nav.state,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    isRefetching: false,
    save: vi.fn(),
    isSaving: false,
    reset: vi.fn(),
    isResetting: false,
  }),
}));

vi.mock("@/modules/navigation/i18n", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/modules/navigation/i18n")>();
  return { ...mod, useNavStrings: () => mod.navStrings("en") };
});

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NavigationPage />
    </QueryClientProvider>,
  );

describe("NavigationPage local-only memo-backup hint", () => {
  it("shows the note when the last save skipped the memo backup", () => {
    nav.state = {
      config: createSeedConfig(),
      memoName: "memos/x",
      source: "local",
      memoSync: "skipped-too-large",
    };
    renderPage();
    expect(screen.getByTestId("nav-local-only-note")).toHaveTextContent("Saved on this device only");
  });

  it("hides the note when the memo backup is in sync", () => {
    nav.state = {
      config: createSeedConfig(),
      memoName: "memos/x",
      source: "memo",
      memoSync: "synced",
    };
    renderPage();
    expect(screen.queryByTestId("nav-local-only-note")).not.toBeInTheDocument();
  });
});
