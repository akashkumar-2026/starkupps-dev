/// <reference types="@types/google.maps" />

/**
 * The delivery map: a pin the customer can drag onto their own door.
 *
 * ## Why a map at all
 *
 * Reverse geocoding is reliably accurate to the street and unreliably accurate to
 * the house. In dense Indian towns — the whole delivery footprint — a GPS fix
 * can land 50–150 m away, on the wrong side of a road or in a neighbouring
 * colony, and the resulting address names a building the customer does not live
 * in. Filling the field and calling it done would send a driver to the wrong
 * place.
 *
 * So the pin is a *proposal* the customer corrects, and correcting it must not
 * require re-running geolocation or retyping. Dragging the marker re-runs the
 * reverse lookup, which is the whole point of having a map here.
 *
 * ## Degradation is the design constraint
 *
 * Nothing in checkout depends on this component rendering. With no API key, a
 * blocked script, or a browser without the Maps API, it renders nothing and the
 * "use my current location" button plus the address field behave exactly as
 * before. It never throws, and it never blocks the form.
 *
 * ## Notes on the API choices
 *
 * * **Classic `Marker`, not `AdvancedMarkerElement`.** The advanced marker
 *   requires a Cloud `mapId` and fails without one; the classic marker works
 *   unaided. It is soft-deprecated, but a deprecated marker beats a blank map.
 * * **`gestureHandling: "greedy"`.** The map lives inside a scrollable checkout,
 *   so one-finger panning must pan the map rather than the page. It is opted out
 *   of explicitly because the default (`cooperative`) makes a small map feel
 *   broken.
 * * **Attribution stays on.** Google requires "© Google" on any map, so only the
 *   zoom and street-view chrome is stripped.
 */
import { useEffect, useRef, useState } from "react";

import { mapsConfigured, mapsStatus, loadGoogleMaps, type MapsStatus } from "./maps-loader";

export type MapCoords = { lat: number; lon: number };

/**
 * `lon` → `lng`.
 *
 * The rest of the codebase — `locate`, the `public.geocode` tRPC input, the
 * Nominatim query — speaks `lon`, because that is what those APIs and the wire
 * format use. Google's JS types spell it `lng`. Converting at this boundary is
 * cheaper than renaming the convention everywhere.
 */
function toLatLng(lat: number, lon: number): google.maps.LatLngLiteral {
  return { lat, lng: lon };
}

type Props = {
  /** Where the pin currently sits. Changing it moves the pin. */
  coords: MapCoords;
  /**
   * Called when the customer moves the pin.
   *
   * Fires on `dragend` and on a map tap — never during a drag — so a long
   * adjustment does not fire a reverse lookup per pixel.
   */
  onMove: (coords: MapCoords) => void;
  /** Shown above the map while the script loads. */
  className?: string;
};

/** Opens at street level: close enough to judge a pin, wide enough to move it. */
const INITIAL_ZOOM = 17;

export function LocationMap({ coords, onMove, className }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const listenersRef = useRef<google.maps.MapsEventListener[]>([]);
  /**
   * `onMove` is re-created on every parent render. Google listeners are attached
   * once, so the latest callback is read through a ref instead of resubscribing.
   */
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  const [status, setStatus] = useState<MapsStatus>(mapsConfigured() ? "ready" : "unconfigured");

  useEffect(() => {
    if (!mapsConfigured()) {
      setStatus("unconfigured");
      return;
    }

    let cancelled = false;
    const container = containerRef.current;

    void loadGoogleMaps().then((ok) => {
      // Unmounted before the script finished — do not touch the DOM.
      if (cancelled) return;
      if (!ok || !container) {
        setStatus(mapsStatus(false));
        return;
      }

      try {
        const map = new google.maps.Map(container, {
          center: toLatLng(coords.lat, coords.lon),
          zoom: INITIAL_ZOOM,
          gestureHandling: "greedy",
          // Keep the © Google attribution; drop only the rest of the chrome.
          disableDefaultUI: true,
          zoomControl: true,
          clickableIcons: false,
        });
        mapRef.current = map;

        const marker = new google.maps.Marker({
          map,
          position: toLatLng(coords.lat, coords.lon),
          draggable: true,
          title: "Your delivery location",
        });
        markerRef.current = marker;

        listenersRef.current = [
          marker.addListener("dragend", () => {
            const position = marker.getPosition();
            if (!position) return;
            onMoveRef.current({ lat: position.lat(), lon: position.lng() });
          }),
          map.addListener("click", (event: google.maps.MapMouseEvent) => {
            if (!event.latLng) return;
            const next = { lat: event.latLng.lat(), lon: event.latLng.lng() };
            marker.setPosition(toLatLng(next.lat, next.lon));
            onMoveRef.current(next);
          }),
        ];

        setStatus("ready");
      } catch {
        // A missing Maps library, a revoked key, or a container the browser
        // refused to size. All are "no map", never "no checkout".
        setStatus("failed");
      }
    });

    return () => {
      cancelled = true;
      // Detach before dropping the references, or Google keeps the closures (and
      // the whole component) alive.
      for (const listener of listenersRef.current) {
        listener.remove();
      }
      listenersRef.current = [];
      markerRef.current?.setMap(null);
      markerRef.current = null;
      mapRef.current = null;
    };
    // Deliberately mount-only: the map and its marker are created once. Later
    // coordinate changes are handled by the effect below, which moves the pin
    // without rebuilding the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow coordinates that changed from outside — a fresh "use my location", or
  // an undo. Moves the pin and recentres without recreating either.
  useEffect(() => {
    const position = toLatLng(coords.lat, coords.lon);
    markerRef.current?.setPosition(position);
    // `setCenter` is typed as LatLng, not LatLngLiteral, on the Map class.
    mapRef.current?.setCenter(new google.maps.LatLng(coords.lat, coords.lon));
  }, [coords.lat, coords.lon]);

  // Nothing to draw without a key, or once loading has failed. The address field
  // above is unaffected either way.
  if (status !== "ready" && status !== "failed") return null;
  if (status === "failed") return null;

  return (
    <div className={className}>
      <div
        ref={containerRef}
        className="h-56 w-full overflow-hidden rounded-xl border border-border sm:h-72"
        aria-label="Map for adjusting your delivery location"
      />
      <p className="mt-1.5 text-xs text-muted-foreground">
        Drag the pin or tap the map to set your exact location.
      </p>
    </div>
  );
}
