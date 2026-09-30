import { publicProcedure, router } from "../lib/trpc";

export const systemRouter = router({
  health: publicProcedure.query(() => ({
    status: "ok" as const,
    timestamp: new Date().toISOString(),
  })),
});
