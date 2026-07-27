// Cross-Service Object-Ownership Proof — type definitions
// Strictly follows the Clean-room spec (CSOP).

export type DBG = Service[];

export interface Service {
  name: string;
  nodes: Node[];
  edges: Edge[];
}

export type Node = Entrypoint | Sink | HttpCall | OwnershipCheck;

export interface Entrypoint {
  id: string;
  kind: "entrypoint";
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  principal: "authenticated" | "public";
  /**
   * public  = reachable from the outside world (directly attackable).
   * internal = reachable ONLY via a stitched service call (not directly attackable).
   * Default: "public" (the safe/suspicious assumption).
   */
  exposure?: "public" | "internal";
  params: { name: string; source: "path" | "query" | "body" | "header" }[];
}

export interface Sink {
  id: string;
  kind: "sink";
  op: "read" | "create" | "update" | "delete";
  table: string;
  objectIdParam: string | null;
  ownershipScoped: boolean;
}

export interface HttpCall {
  id: string;
  kind: "httpCall";
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  target: string;
  forwarded: { calleeParam: string; fromParam: string }[];
}

export interface OwnershipCheck {
  id: string;
  kind: "ownershipCheck";
  verifiesParam: string;
}

export interface Edge {
  from: string;
  to: string;
  type: "reaches" | "dataflow";
  value?: string;
}

export interface Report {
  summary: {
    services: number;
    stitchedEdges: number;
    sinksAnalyzed: number;
    provenSafe: number;
    unprovenLocal: number;
    unprovenXService: number;
  };
  crossServiceEdges: {
    fromService: string;
    fromCall: string;
    toService: string;
    toEntrypoint: string;
    method: string;
    path: string;
  }[];
  findings: Finding[];
}

export interface Finding {
  verdict: "UNPROVEN_XSERVICE" | "UNPROVEN_LOCAL";
  service: string;
  sink: string;
  table: string;
  op: string;
  objectIdLabel: "CALLER_SUPPLIED" | "UNKNOWN";
  path: string[];
  message: string;
}

export class MalformedInputError extends Error {
  code = "MALFORMED_INPUT" as const;
  detail: string;
  constructor(detail: string) {
    super(`MALFORMED_INPUT: ${detail}`);
    this.detail = detail;
  }
}
