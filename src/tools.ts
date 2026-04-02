/**
 * Tool registry — aggregates all available tools.
 */

import type { Tools } from "./Tool.js";

// Core tools
import { BashTool } from "./tools/BashTool/index.js";
import { FileReadTool } from "./tools/FileReadTool/index.js";
import { FileWriteTool } from "./tools/FileWriteTool/index.js";
import { FileEditTool } from "./tools/FileEditTool/index.js";
import { GlobTool } from "./tools/GlobTool/index.js";
import { GrepTool } from "./tools/GrepTool/index.js";
import { WebFetchTool } from "./tools/WebFetchTool/index.js";

// Advanced tools
import { WebSearchTool } from "./tools/WebSearchTool/index.js";
import { TaskCreateTool } from "./tools/TaskCreateTool/index.js";
import { TaskUpdateTool } from "./tools/TaskUpdateTool/index.js";
import { TaskListTool } from "./tools/TaskListTool/index.js";
import { AskUserTool } from "./tools/AskUserTool/index.js";
import { SkillTool } from "./tools/SkillTool/index.js";
import { AgentTool } from "./tools/AgentTool/index.js";
import { EnterPlanModeTool } from "./tools/EnterPlanModeTool/index.js";
import { ExitPlanModeTool } from "./tools/ExitPlanModeTool/index.js";
import { NotebookEditTool } from "./tools/NotebookEditTool/index.js";
import { ImageReadTool } from "./tools/ImageReadTool/index.js";

/**
 * Returns all registered tools.
 */
export function getAllTools(): Tools {
  return [
    // Core (always available)
    BashTool,
    FileReadTool,
    ImageReadTool,
    FileWriteTool,
    FileEditTool,
    GlobTool,
    GrepTool,
    WebFetchTool,
    WebSearchTool,
    // Task management
    TaskCreateTool,
    TaskUpdateTool,
    TaskListTool,
    // Agent interaction
    AskUserTool,
    SkillTool,
    AgentTool,
    // Planning
    EnterPlanModeTool,
    ExitPlanModeTool,
    // Notebooks
    NotebookEditTool,
  ];
}
