import type { Server } from "bun";
import type { DaemonEngine } from "../engine/state-machine";
import type { JjOperations } from "../jj/operations";
import { logger } from "../util/logger";
import { dashboardHtml } from "./dashboard";

/**
 * Minimal HTTP API for external triggers and status queries.
 */
export class ApiServer {
  private server: Server | null = null;

  constructor(
    private engine: DaemonEngine,
    private jj: JjOperations,
    private port: number,
    private onStop: () => void
  ) {}

  start() {
    if (this.port === 0) {
      logger.info("API server disabled (port=0)");
      return;
    }

    this.server = Bun.serve({
      port: this.port,
      fetch: async (req) => this.handleRequest(req),
    });

    logger.info(`API server listening on http://localhost:${this.port}`);
  }

  stop() {
    if (this.server) {
      this.server.stop(true);
      this.server = null;
      logger.info("API server stopped");
    }
  }

  private async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
      // GET / — dashboard UI
      if (method === "GET" && (path === "/" || path === "")) {
        return new Response(dashboardHtml(this.port), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      // GET /status
      if (method === "GET" && path === "/status") {
        const daemonStatus = this.engine.getStatus();
        const jjStatus = await this.jj.status();
        return json({
          daemon: daemonStatus,
          repo: {
            changeId: jjStatus.workingCopy.changeId,
            description: jjStatus.workingCopy.description,
            empty: jjStatus.workingCopy.empty,
            bookmarks: jjStatus.workingCopy.bookmarks,
            fileChanges: jjStatus.fileChanges.length,
            hasConflicts: jjStatus.hasConflicts,
          },
        });
      }

      // POST /describe
      if (method === "POST" && path === "/describe") {
        const message = await this.engine.manualDescribe();
        return json({ ok: true, message });
      }

      // POST /push
      if (method === "POST" && path === "/push") {
        const pushed = await this.engine.manualPush();
        return json({ ok: true, pushed });
      }

      // POST /checkpoint
      if (method === "POST" && path === "/checkpoint") {
        let description = "";
        try {
          const body = await req.json();
          description = body.description ?? "";
        } catch {
          // No body is fine
        }
        const checkpoint = await this.engine.manualCheckpoint(description);
        return json({ ok: true, checkpoint });
      }

      // POST /rollback/:id
      if (method === "POST" && path.startsWith("/rollback/")) {
        const id = parseInt(path.split("/")[2], 10);
        if (isNaN(id)) return json({ error: "Invalid checkpoint ID" }, 400);
        await this.engine.rollback(id);
        return json({ ok: true });
      }

      // GET /checkpoints
      if (method === "GET" && path === "/checkpoints") {
        const checkpoints = this.engine.listCheckpoints();
        return json({ checkpoints });
      }

      // POST /stop
      if (method === "POST" && path === "/stop") {
        this.onStop();
        return json({ ok: true, message: "Shutting down" });
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      logger.error(`API error on ${method} ${path}: ${err}`);
      return json({ error: String(err) }, 500);
    }
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
