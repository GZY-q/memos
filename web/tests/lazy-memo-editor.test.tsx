import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LazyMemoEditor from "@/components/MemoEditor/LazyMemoEditor";

vi.mock("@/components/MemoEditor", () => ({
  default: () => <div data-testid="real-editor" />,
}));

describe("<LazyMemoEditor>", () => {
  it("shows a placeholder until the editor chunk resolves, then renders the editor", async () => {
    const { container } = render(<LazyMemoEditor placeholder="hi" />);

    expect(screen.queryByTestId("real-editor")).not.toBeInTheDocument();
    expect(container.querySelector(".animate-pulse")).not.toBeNull();

    expect(await screen.findByTestId("real-editor")).toBeInTheDocument();
    expect(container.querySelector(".animate-pulse")).toBeNull();
  });
});
