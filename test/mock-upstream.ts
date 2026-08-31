/**
 * Scriptable mock upstream for integration tests: a local Node http server
 * that can return 429/5xx, hang, break a stream mid-flight, or relay a
 * normal SSE stream — without touching real provider quota.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface CapturedRequest {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: Record<string, unknown> | undefined;
}

export interface MockBehavior {
  status: number;
  headers?: Record<string, string>;
  /** Full JSON body for non-streaming responses. */
  body?: string;
  /** SSE event strings (complete, with "\n\n" terminators) streamed in order. */
  events?: string[];
  /** Delay between consecutive SSE events (ms). */
  eventDelayMs?: number;
  /** Delay before the response starts at all (ms). */
  startDelayMs?: number;
  /** Send this many events, then destroy the socket (broken stream). */
  breakAfterEvents?: number;
  /** Keep the response open after all events (simulates a silent stream). */
  hang?: boolean;
  /** Destroy the socket without any response bytes (mid-body abort). */
  destroy?: boolean;
}

export interface MockUpstream {
  port: number;
  url: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
}

export function startMockUpstream(
  behavior: MockBehavior | ((captured: CapturedRequest) => MockBehavior),
): Promise<MockUpstream> {
  const requests: CapturedRequest[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on("end", () => {
      let body: Record<string, unknown> | undefined;
      try {
        body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
      } catch {
        body = undefined;
      }
      const captured: CapturedRequest = { method: req.method ?? "POST", url: req.url ?? "/", headers: req.headers, body };
      requests.push(captured);
      const b = typeof behavior === "function" ? behavior(captured) : behavior;

      const respond = () => {
        if (b.destroy) {
          res.destroy();
          return;
        }
        res.writeHead(b.status, b.headers ?? { "content-type": "application/json" });
        if (b.events && b.events.length > 0) {
          b.events.forEach((event, i) => {
            const delay = (i + 1) * (b.eventDelayMs ?? 0);
            setTimeout(() => {
              if (b.breakAfterEvents !== undefined && i >= b.breakAfterEvents) {
                res.destroy();
                return;
              }
              res.write(event);
              if (i === b.events!.length - 1 && !b.hang) res.end();
            }, delay);
          });
          return;
        }
        res.end(b.body ?? "");
      };

      if (b.startDelayMs && b.startDelayMs > 0) {
        setTimeout(respond, b.startDelayMs);
      } else {
        respond();
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        port,
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
            // Hung/destroyed sockets must not keep the test process alive.
            server.closeAllConnections();
          }),
      });
    });
  });
}
