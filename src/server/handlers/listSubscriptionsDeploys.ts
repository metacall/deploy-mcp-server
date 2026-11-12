import { api } from "../../protocol/client.js";
import { createToolHandler } from "../toolFactory.js";
import { ListSubscriptionsDeploysSchema } from "../schemas/listSubscriptionsDeploys.schema.js";
import type { MCPToolDefinition } from "../types.js";

//definition of the "listSubscriptionsDeploys" tool.It lists deployments associated with billing subscriptions in MetaCall FaaS.
export const listSubscriptionsDeploysTool: MCPToolDefinition = {
  name: "listSubscriptionsDeploys",
  description:
  "Retrieves deployments associated with the account's billing subscriptions. Note: @metacall/protocol 0.1.35 queries the subscription list endpoint, so this currently returns subscription plan entries rather than deployment associations (fixed upstream in metacall/protocol#61, not yet released).",
  schema: ListSubscriptionsDeploysSchema,

  execute: createToolHandler(
    ListSubscriptionsDeploysSchema,
    async () => {
      const deployments = await api.listSubscriptionsDeploys();
      return {
        count: deployments.length,
        deployments
      };
    }
  )
};