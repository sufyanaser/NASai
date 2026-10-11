import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";

describe("App shell", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("presents the primary workflow and safety status", () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "What should we build?" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Safe mode")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Start task ↗" }),
    ).toBeInTheDocument();
  });

  it("moves through reactive agent states and records a verified task", async () => {
    vi.useFakeTimers();
    render(<App />);

    fireEvent.change(screen.getByLabelText("Task description"), {
      target: { value: "Review the update flow" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start task ↗" }));

    expect(
      screen.getByRole("button", { name: /NASai status: Thinking/ }),
    ).toBeInTheDocument();
    await act(async () => vi.advanceTimersByTimeAsync(3_200));

    expect(
      screen.getByRole("button", { name: /NASai status: Verified/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Task verified" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Review the update flow", { selector: "strong" }),
    ).toBeInTheDocument();
  });

  it("shows a recoverable attention state for a simulated failure", async () => {
    vi.useFakeTimers();
    render(<App />);

    fireEvent.change(screen.getByLabelText("Task description"), {
      target: { value: "Diagnose this error" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start task ↗" }));
    await act(async () => vi.advanceTimersByTimeAsync(3_200));

    expect(
      screen.getByRole("button", { name: /NASai status: Needs you/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("I found something that needs your attention."),
    ).toBeVisible();
  });
});
