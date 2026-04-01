/**
 * Tool registry — aggregates all available tools.
 */

import type { Tools } from "./Tool.js";
import { BashTool } from "./tools/BashTool/index.js";
import { FileReadTool } from "./tools/FileReadTool/index.js";
import { FileWriteTool } from "./tools/FileWriteTool/index.js";
import { FileEditTool } from "./tools/FileEditTool/index.js";
import { GlobTool } from "./tools/GlobTool/index.js";

/**
 * Returns all registered tools.
 * GrepTool and WebFetchTool are excluded until implemented.
 */
export function getAllTools(): Tools {
  return [
    BashTool,
    FileReadTool,
    FileWriteTool,
    FileEditTool,
    GlobTool,
  ];
}
