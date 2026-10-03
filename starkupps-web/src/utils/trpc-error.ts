/**
 * A failed call to the Admin gateway's tRPC endpoint.
 *
 * Extends `ApiError` so existing `instanceof ApiError` / `.isNotFound` handling
 * keeps working, and adds `domainCode` — the server's stable, machine-readable
 * reason for the rejection. Call sites classify on that instead of
 * pattern-matching the server's English prose.
 *
 * @see src/config/order-error-codes.ts for the code vocabulary.
 */
import { ApiError } from "@/api/client";
import type { OrderDomainCode } from "@/config/order-error-codes";

export class TrpcError extends ApiError {
  /** Server-supplied reason, or `undefined` when the response carried none. */
  override readonly domainCode: OrderDomainCode | undefined;

  constructor(message: string, status: number, procedure: string, domainCode?: OrderDomainCode) {
    super(message, status, procedure);
    this.name = "TrpcError";
    this.domainCode = domainCode;
  }
}

/**
 * Narrows any thrown value to an error carrying a domain code.
 *
 * Checks `ApiError` rather than only `TrpcError`: REST is the primary transport
 * for public endpoints and forwards `domainCode` as well, so gating on the tRPC
 * subclass would report "no code" for the very errors this exists to classify.
 */
export function hasDomainCode(error: unknown): error is ApiError {
  return error instanceof ApiError && typeof error.domainCode === "string";
}

/** Reads the domain code off any thrown value, if it has one. */
export function domainCodeOf(error: unknown): OrderDomainCode | undefined {
  return hasDomainCode(error) ? (error.domainCode as OrderDomainCode) : undefined;
}
