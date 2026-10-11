import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App shell", () => {
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
});
