import { ZodSchema } from "zod";
import { safeExecute } from "../utils/errorBoundary.js";
import { redactCredentials, withAuthentication } from "../protocol/client.js";

// Factory function to create a tool handler that validates input using a Zod schema and executes the provided logic.
export function createToolHandler<T>(
  schema: ZodSchema<T>,
  executor: (args: T) => Promise<any>,
  options: { authenticate?: boolean } = {}
) {
  return async (rawArgs: unknown) => {
    let args: T;
    try {
      // params.arguments is optional in tools/call, and clients legitimately omit it
      // for tools that take none. Parsing undefined would fail every empty schema and
      // reduce real validation errors to one root-level "expected object".
      args = schema.parse(rawArgs ?? {});
    } catch (error) {
      // Keep the SDK/Zod error contract while removing echoed credentials.
      if (error instanceof Error) {
        Object.defineProperty(error, "message", { value: redactCredentials(error.message), configurable: true });
      }
      throw error;
    }
    return safeExecute(() => options.authenticate === false
      ? executor(args)
      : withAuthentication(() => executor(args)));
  };
}
