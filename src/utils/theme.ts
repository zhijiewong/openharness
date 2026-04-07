/**
 * Theme system with React context for Ink components.
 * Re-exports theme data from theme-data.ts (no React dependency).
 */

import React from "react";
export { type Theme, darkTheme, lightTheme, getTheme } from "./theme-data.js";
import { darkTheme } from "./theme-data.js";
import type { Theme } from "./theme-data.js";

const ThemeContext = React.createContext<Theme>(darkTheme);

export const ThemeProvider = ThemeContext.Provider;

export function useTheme(): Theme {
  return React.useContext(ThemeContext);
}
