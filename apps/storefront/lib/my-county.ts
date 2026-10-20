"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "zaroda_my_county";

const read = (): string => {
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
};

/**
 * The county the shopper told us they are in, remembered on their phone. It is used to show which shops deliver to them
 * and to pre-fill checkout; the shop still checks the delivery county itself when the order is placed.
 */
export function useMyCounty(): [string, (county: string) => void] {
  const [county, setCountyState] = useState("");

  useEffect(() => {
    setCountyState(read());
    const onChange = () => setCountyState(read());
    window.addEventListener("zaroda-county", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("zaroda-county", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  const setCounty = useCallback((next: string) => {
    try {
      if (next) window.localStorage.setItem(KEY, next);
      else window.localStorage.removeItem(KEY);
    } catch {
      /* private window: it just will not be remembered */
    }
    setCountyState(next);
    window.dispatchEvent(new Event("zaroda-county"));
  }, []);

  return [county, setCounty];
}
