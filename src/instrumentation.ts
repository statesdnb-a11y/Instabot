export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { bootQueue } = await import("@/lib/queue");
    const { armScheduler } = await import("@/lib/schedule");
    bootQueue();
    armScheduler();
  }
}
