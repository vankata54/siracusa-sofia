/* For the specs that start their own server (E2E_PORT + n, docs/AGENTS.md "Портове"): stop at once with a clear message
   when the port is taken (another agent's or a manual server), instead of testing against someone else's database. */
import net from "node:net";

export async function assertPortFree(port: number): Promise<void> {
  const free = await new Promise<boolean>((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });
  if (!free) throw new Error("port " + port + " is taken: give this agent its own E2E_PORT block (docs/AGENTS.md, Портове)");
}
