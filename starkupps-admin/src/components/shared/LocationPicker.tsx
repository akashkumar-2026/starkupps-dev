import { MapView } from "@/components/map/MapView";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { env } from "@/config/env";
import { usePersistFn } from "@/hooks/use-persist-fn";
import { useEffect, useRef, useState } from "react";

type Props = {
  latitude: number | null;
  longitude: number | null;
  onChange: (lat: number | null, lng: number | null, address?: string) => void;
  disabled?: boolean;
};

export function LocationPicker({
  latitude,
  longitude,
  onChange,
  disabled,
}: Props) {
  const [search, setSearch] = useState("");
  const [mapReady, setMapReady] = useState(false);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<
    google.maps.marker.AdvancedMarkerElement | google.maps.Marker | null
  >(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The parent re-creates `onChange` on every render, and `updateMarker` closes
  // over `disabled`. Persist both so the Google Maps listeners can be attached
  // once instead of re-subscribing on every parent update.
  const emitChange = usePersistFn(onChange);
  const isDraggable = !disabled;

  // Default center: India
  const center =
    latitude != null && longitude != null
      ? { lat: latitude, lng: longitude }
      : { lat: 22.9734, lng: 78.6569 };
  const zoom = latitude != null && longitude != null ? 14 : 5;

  useEffect(() => {
    if (!env.mapsEnabled) return;
    if (!inputRef.current || !window.google?.maps?.places) return;
    try {
      autocompleteRef.current = new window.google.maps.places.Autocomplete(
        inputRef.current,
        {
          types: ["geocode"],
          componentRestrictions: { country: "in" },
        }
      );
      autocompleteRef.current.addListener("place_changed", () => {
        const place = autocompleteRef.current?.getPlace();
        if (!place?.geometry?.location) return;
        const lat = place.geometry.location.lat();
        const lng = place.geometry.location.lng();
        emitChange(lat, lng, place.formatted_address);
        setSearch(place.formatted_address || "");
        if (mapRef.current) {
          mapRef.current.setCenter({ lat, lng });
          mapRef.current.setZoom(15);
          updateMarker({ lat, lng });
        }
      });
    } catch {
      // Autocomplete is an enhancement: the map and pin still work without it.
    }
    // `usePersistFn` guarantees a stable identity for both, so this effect runs
    // once per map instance. The lint rule cannot see that guarantee.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  const updateMarker = usePersistFn((pos: google.maps.LatLngLiteral) => {
    if (!mapRef.current || !window.google) return;
    if (markerRef.current) {
      if ((markerRef.current as any).position)
        (markerRef.current as any).position = pos;
      else (markerRef.current as any).setPosition(pos);
      return;
    }
    try {
      if (window.google.maps.marker?.AdvancedMarkerElement) {
        markerRef.current = new window.google.maps.marker.AdvancedMarkerElement(
          {
            map: mapRef.current,
            position: pos,
            gmpDraggable: isDraggable,
          }
        );
        markerRef.current.addListener?.("dragend", (e: any) => {
          const lat = e.latLng?.lat();
          const lng = e.latLng?.lng();
          if (lat != null && lng != null) emitChange(lat, lng);
        });
      } else {
        const m = new window.google.maps.Marker({
          map: mapRef.current,
          position: pos,
          draggable: isDraggable,
        });
        m.addListener("dragend", (e: any) => {
          const lat = e.latLng?.lat();
          const lng = e.latLng?.lng();
          if (lat != null && lng != null) emitChange(lat, lng);
        });
        markerRef.current = m;
      }
    } catch {
      // A missing Maps library must not break the surrounding form.
    }
  });

  const handleMapReady = (map: google.maps.Map) => {
    mapRef.current = map;
    setMapReady(true);
    if (latitude != null && longitude != null) {
      updateMarker({ lat: latitude, lng: longitude });
    }
    map.addListener("click", (e: any) => {
      if (disabled) return;
      const lat = e.latLng?.lat();
      const lng = e.latLng?.lng();
      if (lat == null || lng == null) return;
      emitChange(lat, lng);
      updateMarker({ lat, lng });
      // Reverse geocode to update address search
      try {
        const geocoder = new window.google.maps.Geocoder();
        geocoder.geocode({ location: { lat, lng } }, (results, status) => {
          if (status === "OK" && results?.[0]) {
            setSearch(results[0].formatted_address || "");
          }
        });
      } catch {
        // Reverse geocoding is optional; the pin still moves without it.
      }
    });
  };

  useEffect(() => {
    if (mapRef.current && latitude != null && longitude != null) {
      mapRef.current.setCenter({ lat: latitude, lng: longitude });
      updateMarker({ lat: latitude, lng: longitude });
    }
  }, [latitude, longitude, updateMarker]);

  if (!env.mapsEnabled) {
    return (
      <div className="space-y-2">
        <Label className="text-xs font-bold">Location / Map Picker</Label>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
          Map picker requires <code>VITE_GOOGLE_MAPS_API_KEY</code>. Set it in{" "}
          <code>.env</code> to enable address search and pin. Coordinates will
          be saved if you provide them via the address fields.
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="rounded-lg bg-white p-2 font-mono text-[11px]">
              Lat: {latitude ?? "—"}
            </div>
            <div className="rounded-lg bg-white p-2 font-mono text-[11px]">
              Lng: {longitude ?? "—"}
            </div>
          </div>
        </div>
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search address (requires Maps API)"
          className="bg-white text-xs"
          disabled
        />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label className="text-xs font-bold">Location / Map Picker</Label>
      <Input
        ref={inputRef}
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search address, e.g. MG Road, Bengaluru"
        className="bg-white text-xs"
        disabled={disabled}
      />
      <div className="overflow-hidden rounded-xl border border-[#DCCFC2]">
        <MapView
          initialCenter={center}
          initialZoom={zoom}
          onMapReady={handleMapReady}
          className="h-[280px]"
        />
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-lg border border-[#E4DCD1] bg-[#F6F0E8] px-3 py-2 font-mono">
          Lat: {latitude != null ? latitude.toFixed(6) : "—"}
        </div>
        <div className="rounded-lg border border-[#E4DCD1] bg-[#F6F0E8] px-3 py-2 font-mono">
          Lng: {longitude != null ? longitude.toFixed(6) : "—"}
        </div>
      </div>
      <p className="text-[11px] text-[#87796C]">
        Search or click/drag the pin. Coordinates are validated server-side.
      </p>
    </div>
  );
}
