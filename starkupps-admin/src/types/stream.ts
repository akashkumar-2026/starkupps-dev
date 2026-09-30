/** Operational table the gateway relays changes for. */
export type StreamTable = "orders" | "deliveries";

/** Payload of one `change` event on `/api/stream/admin`. */
export type StreamEvent = {
  table: StreamTable;
  event: "INSERT" | "UPDATE" | "DELETE";
  id: number;
  outletId: number | null;
  status: string | null;
  orderNumber: number | null;
};
