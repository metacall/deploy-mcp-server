import { api } from "../../protocol/client.js";
import { createToolHandler } from "../toolFactory.js";
import { ListSubscriptionsSchema } from "../schemas/listSubscriptions.schema.js";
import type { MCPToolDefinition } from "../types.js";

// List available subscription entries grouped by plan.
export const listSubscriptionsTool: MCPToolDefinition = {
  name: "listSubscriptions",

  description:
  "Lists subscription entries per plan in the MetaCall account. The usageCount field counts subscription entries, not deployment usage or occupancy.",

  schema: ListSubscriptionsSchema,

  execute: createToolHandler(
    ListSubscriptionsSchema,

    async () => {
      const subscriptions = await api.listSubscriptions();

      return {
        totalPlans: Object.keys(subscriptions).length,
        plans: Object.entries(subscriptions).map(([id, count]) => ({
          id,
          usageCount: count
        }))
      };
    }
  )
};
