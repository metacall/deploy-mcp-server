import { isProtocolError } from "@metacall/protocol";

// Utility function to safely execute an asynchronous function and handle errors without crashing the server. 
// It distinguishes between protocol errors and other types of errors, providing more informative error messages.
export async function safeExecute<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {

    if (isProtocolError(err)) {
      // err.data is the raw FaaS response body and may carry credentials or other
      // sensitive values, so only the status and the message are surfaced.
      throw new Error(JSON.stringify({
        type: "ProtocolError",
        message: err.message,
        status: err.status
      }));
    }

    if (err instanceof Error) {
      throw new Error(JSON.stringify({
        type: "RuntimeError",
        message: err.message
      }));
    }

    throw new Error(JSON.stringify({
      type: "UnknownError"
    }));
  }
}