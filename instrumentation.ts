/** Runs once when the server starts: warm the database (embedded PGlite init + migrations) so the first user request is fast. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getDb } = await import("./lib/db");
  getDb()
    .then(async () => {
      const { recoverOrphanedSearches } = await import("./lib/search/runner");
      await recoverOrphanedSearches();
    })
    .catch((e) => console.error("[startup] database initialisation failed:", e));
}
