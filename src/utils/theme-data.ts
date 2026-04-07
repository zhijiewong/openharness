/**
 * Theme data — framework-agnostic, no React dependency.
 * Import this in the cell renderer instead of theme.ts.
 */

export type Theme = {
  primary: string;
  primaryShimmer: string;
  user: string;
  assistant: string;
  tool: string;
  error: string;
  success: string;
  warning: string;
  border: string;
  dim: string;
  text: string;
  diffAdded: string;
  diffRemoved: string;
  stall: string;
  stallShimmer: string;
  heading: string;
  codeBlock: string;
  codeFence: string;
  bullet: string;
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
  heading: "cyan",
  codeBlock: "gray",
  codeFence: "gray",
  bullet: "cyan",
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
  heading: "cyanBright",
  codeBlock: "blackBright",
  codeFence: "blackBright",
  bullet: "cyanBright",
};

export function getTheme(name: 'dark' | 'light' = 'dark'): Theme {
  return name === 'light' ? lightTheme : darkTheme;
}
