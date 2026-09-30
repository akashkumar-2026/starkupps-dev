import { useRef } from "react";

type AnyFunction = (...args: never[]) => unknown;

/**
 * Returns a referentially stable wrapper around `fn` that always calls the
 * latest version.
 *
 * Use it to hand a callback to a subscription (Google Maps listeners, event
 * listeners, timers) that is registered once: the effect keeps a stable
 * dependency, so it does not tear down and re-subscribe on every render, and it
 * never closes over a stale value.
 */
export function usePersistFn<T extends AnyFunction>(fn: T): T {
  const fnRef = useRef<T>(fn);
  fnRef.current = fn;

  const persistFn = useRef<T | null>(null);
  if (!persistFn.current) {
    persistFn.current = function (this: unknown, ...args) {
      return fnRef.current.apply(this, args);
    } as T;
  }

  return persistFn.current;
}
