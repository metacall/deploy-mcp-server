//import { readyTool } from "./system.js";
import { validateAuthTool } from "./auth.js";
import { deployEnabledTool } from "./account.js";
import { refreshTokenTool } from "./refreshToken.js";
import { inspectTool } from "./inspect.js";
import { inspectByNameTool } from "./inspectByName.js";
import { listSubscriptionsTool } from "./listSubscriptions.js";
import { uploadTool } from "./upload.js";
import { deployTool } from "./deploy.js";
import { addTool } from "./add.js";
import { deployDeleteTool } from "./deployDelete.js";
import { branchListTool } from "./branchList.js";
import { fileListTool } from "./fileList.js";
import { listSubscriptionsDeploysTool } from "./listSubscriptionsDeploys.js";
import { callTool } from "./call.js";
import { awaitTool } from "./await.js";
import { logsTool } from "./logs.js";

//export all tools
export const tools = [
  //readyTool,
  validateAuthTool,
  deployEnabledTool,
  refreshTokenTool,
  inspectTool,
  inspectByNameTool,
  listSubscriptionsTool,
  uploadTool,
  deployTool,
  addTool,
  deployDeleteTool,
  branchListTool,
  fileListTool,
  listSubscriptionsDeploysTool,
  callTool,
  awaitTool,
  logsTool
];
