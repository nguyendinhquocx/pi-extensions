import { requestResponsesCompact } from "./remote-compact.js";
import { requestContextManagement } from "./remote-context-management.js";
import type { RemoteCompactionRequest, RemoteCompactionResponse } from "./remote-types.js";
import { requestRemoteCompactionV2 } from "./remote-v2.js";

export type {
  PriorCheckpointPayload,
  RemoteCompactionRequest,
  RemoteCompactionResponse,
} from "./remote-types.js";

export function requestRemoteCompaction(request: RemoteCompactionRequest): Promise<RemoteCompactionResponse> {
  switch (request.protocol) {
    case "responses-compact":
      return requestResponsesCompact(request);
    case "remote-v2":
      return requestRemoteCompactionV2(request);
    case "context-management":
      return requestContextManagement(request);
    default:
      return Promise.reject(new Error("Unsupported remote compaction protocol"));
  }
}
