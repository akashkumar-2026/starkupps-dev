/**
 * Geolocation, for the delivery address's "use my current location" button.
 *
 * ## The rule this hook exists to enforce
 *
 * **Filling the field must never be the only way forward.** Geolocation is denied
 * by default on most browsers, unavailable over plain HTTP, refused inside some
 * in-app browsers, and routinely inaccurate in dense Indian towns. If any of
 * those look like a dead end the customer simply abandons the order, so every
 * failure resolves to a `reason` the UI can explain while leaving the address
 * field exactly as editable as it was before the button existed.
 *
 * The hook therefore never throws and never clears the field. It reports, and
 * the caller decides.
 */

export type LocationFailure =
  /** The browser has no Geolocation API at all. */
  | "unsupported"
  /** The customer said no, or the browser blocked the prompt. */
  | "denied"
  /** Permission was granted but no position ever arrived. */
  | "unavailable"
  /** Geolocation requires HTTPS; this page is not a secure context. */
  | "insecure-context"
  /** The request is still open after our own deadline. */
  | "timeout";

export type LocateResult =
  { ok: true; lat: number; lon: number } | { ok: false; reason: LocationFailure };

export type LocateState = {
  status: "idle" | "locating" | "located" | "error";
  coords: { lat: number; lon: number } | null;
  reason: LocationFailure | null;
};

export const initialLocateState: LocateState = {
  status: "idle",
  coords: null,
  reason: null,
};

/**
 * How long to wait before giving up on a position.
 *
 * A desktop browser with a poor fix can leave the prompt pending for a long
 * time. Without a deadline the button spins indefinitely on a machine with no
 * GPS, which reads as a broken page.
 */
const LOCATE_TIMEOUT_MS = 12_000;

/**
 * Maps a `GeolocationPositionError` code to a reason the UI can act on.
 *
 * `PERMISSION_DENIED` is the one that genuinely needs wording — the customer
 * said no, and "couldn't get your location" would be confusing. The rest are
 * environmental.
 */
export function geolocationFailureReason(code: number | undefined): LocationFailure {
  switch (code) {
    case 1:
      return "denied";
    case 3:
      return "timeout";
    default:
      return "unavailable";
  }
}

/**
 * Short, human copy for each failure.
 *
 * Deliberately non-blaming and always ends with the way forward, because the
 * field stays editable in every case.
 */
export function locateFailureMessage(reason: LocationFailure): string {
  switch (reason) {
    case "denied":
      return "Location access was blocked. You can turn it on in your browser's site settings, or just type your address.";
    case "unsupported":
      return "This browser can't share your location. Please type your address.";
    case "insecure-context":
      return "Location needs a secure (https) connection. Please type your address.";
    case "timeout":
      return "That took too long to find you. Please type your address, or try again.";
    default:
      return "We couldn't determine your location. Please type your address.";
  }
}

/** Pure part of `locate`, so its decision table is testable. */
export async function locate(): Promise<LocateResult> {
  if (typeof window === "undefined") return { ok: false, reason: "unsupported" };
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return { ok: false, reason: "unsupported" };
  }
  // `window.isSecureContext` is false on plain http (other than localhost) and
  // inside some sandboxed frames. Checking it up front produces a precise
  // message instead of the browser's generic "position unavailable".
  if (window.isSecureContext === false) {
    return { ok: false, reason: "insecure-context" };
  }

  return new Promise<LocateResult>((resolve) => {
    let settled = false;
    const finish = (result: LocateResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => finish({ ok: false, reason: "timeout" }), LOCATE_TIMEOUT_MS);

    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            Math.abs(latitude) > 90 ||
            Math.abs(longitude) > 180
          ) {
            // A malformed fix must not reach the geocoder; it would only
            // produce a confidently wrong address.
            finish({ ok: false, reason: "unavailable" });
            return;
          }
          finish({ ok: true, lat: latitude, lon: longitude });
        },
        (error) => finish({ ok: false, reason: geolocationFailureReason(error?.code) }),
        {
          enableHighAccuracy: true,
          // A cached fix is fine here: it is only ever a starting suggestion the
          // customer edits, so waiting for a fresh one only adds latency.
          maximumAge: 60_000,
          timeout: LOCATE_TIMEOUT_MS,
        },
      );
    } catch {
      // Some embedded browsers expose the API but throw on use.
      finish({ ok: false, reason: "unsupported" });
    }
  });
}
