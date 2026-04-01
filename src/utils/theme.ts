/**
 * Semantic theme system for OpenHarness terminal UI.
 * Inspired by Claude Code's 89-color theme with shimmer variants.
 */

import React from "react";

export type Theme = {
  // Brand
  primary: string;
  primaryShimmer: string;

  // Semantic roles
  user: string;
  assistant: string;
  tool: string;
  error: string;
  success: string;
  warning: string;

  // UI chrome
  border: string;
  dim: string;
  text: string;

  // Diffs
  diffAdded: string;
  diffRemoved: string;

  // Spinner states
  stall: string;
  stallShimmer: string;
};

export const darkTheme: Theme = {
  primary: "magenta",
  primaryShimmer: "magentaBright",

  user: "cyan",
  assistant: "magenta",
  tool: "yellow",
  error: "red",
  success: "green",
  warning: "yellow",

  border: "gray",
  dim: "gray",
  text: "white",

  diffAdded: "green",
  diffRemoved: "red",

  stall: "yellow",
  stallShimmer: "redBright",
};

export const lightTheme: Theme = {
  primary: "magentaBright",
  primaryShimmer: "magenta",

  user: "cyanBright",
  assistant: "magentaBright",
  tool: "yellowBright",
  error: "redBright",
  success: "greenBright",
  warning: "yellowBright",

  border: "blackBright",
  dim: "blackBright",
  text: "black",

  diffAdded: "greenBright",
  diffRemoved: "redBright",

  stall: "yellowBright",
  stallShimmer: "red",
};

const ThemeContext = React.createContext<Theme>(darkTheme);

export const ThemeProvider = ThemeContext.Provider;

export function useTheme(): Theme {
  return React.useContext(ThemeContext);
}
