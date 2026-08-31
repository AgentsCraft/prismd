/** Request id generation (node:crypto randomUUID); logs and error responses carry it. */
import { randomUUID } from "node:crypto";

export function newRequestId(): string {
  return randomUUID();
}
