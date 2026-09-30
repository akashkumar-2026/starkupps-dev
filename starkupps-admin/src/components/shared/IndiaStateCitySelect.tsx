import { useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  getIndianStates,
  getIndianCitiesForState,
  getStateIsoByName,
} from "@shared/indiaLocations";

type Props = {
  stateValue: string;
  cityValue: string;
  onStateChange: (state: string) => void;
  onCityChange: (city: string) => void;
  required?: boolean;
  disabled?: boolean;
  stateLabel?: string;
  cityLabel?: string;
};

export function IndiaStateCitySelect({
  stateValue,
  cityValue,
  onStateChange,
  onCityChange,
  required = false,
  disabled = false,
  stateLabel = "State",
  cityLabel = "City",
}: Props) {
  const states = useMemo(() => getIndianStates(), []);
  const [cityQuery, setCityQuery] = useState("");
  const cities = useMemo(() => {
    if (!stateValue) return [];
    const iso = getStateIsoByName(stateValue);
    return iso ? getIndianCitiesForState(iso) : [];
  }, [stateValue]);
  const filteredCities = useMemo(() => {
    if (!cityQuery.trim()) return cities;
    const q = cityQuery.trim().toLowerCase();
    return cities.filter(c => c.name.toLowerCase().includes(q));
  }, [cities, cityQuery]);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="space-y-1.5">
        <span className="text-xs font-bold">
          {stateLabel} {required && "*"}
        </span>
        <Select
          value={stateValue || undefined}
          onValueChange={v => {
            onStateChange(v);
            onCityChange("");
            setCityQuery("");
          }}
          disabled={disabled}
        >
          <SelectTrigger className="bg-white text-xs h-10">
            <SelectValue placeholder="Select state" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {states.map(s => (
              <SelectItem key={s.isoCode} value={s.name}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <label className="space-y-1.5">
        <span className="text-xs font-bold">
          {cityLabel} {required && "*"}
        </span>
        {stateValue && cities.length > 15 && (
          <Input
            value={cityQuery}
            onChange={e => setCityQuery(e.target.value)}
            placeholder="Filter city…"
            className="h-9 bg-white text-xs"
            disabled={disabled}
          />
        )}
        <Select
          value={cityValue || undefined}
          onValueChange={onCityChange}
          disabled={disabled || !stateValue}
        >
          <SelectTrigger className="bg-white text-xs h-10 disabled:opacity-60">
            <SelectValue
              placeholder={stateValue ? "Select city" : "Select state first"}
            />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {filteredCities.length ? (
              filteredCities.map(c => (
                <SelectItem key={`${c.stateCode}-${c.name}`} value={c.name}>
                  {c.name}
                </SelectItem>
              ))
            ) : (
              <div className="p-3 text-center text-xs text-[#87796C]">
                No cities found.
              </div>
            )}
          </SelectContent>
        </Select>
        {!stateValue ? (
          <p className="text-[11px] text-[#87796C]">
            Choose state first to see cities.
          </p>
        ) : (
          <p className="text-[11px] text-[#87796C]">
            {filteredCities.length} cities
          </p>
        )}
      </label>
    </div>
  );
}
