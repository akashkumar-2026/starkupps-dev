import { createTRPCReact } from "@trpc/react-query";

import type { AppRouter } from "../../server/routers";

/**
 * Typed tRPC client. `AppRouter` is inferred from the server entry point, so
 * renaming a procedure is a compile error in the browser bundle too.
 */
export const trpc = createTRPCReact<AppRouter>();
