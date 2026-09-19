import { hamburgAdapter } from "./hamburg/adapter";
import type { CityAdapter } from "@/lib/model/types";

// Registry of city adapters. Adding a new city is: implement CityAdapter,
// add it here. Nothing in the map/UI layer knows about Hamburg specifically.
const ADAPTERS: Record<string, CityAdapter> = {
  hamburg: hamburgAdapter,
};

export function getAdapter(city: string): CityAdapter | undefined {
  return Object.hasOwn(ADAPTERS, city) ? ADAPTERS[city] : undefined;
}
