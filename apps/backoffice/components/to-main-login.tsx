"use client";

import { useEffect } from "react";
import { posUrl } from "../lib/product";

/** Build, Rentals and Shamba have no sign-in of their own any more: everyone signs in on the one page at the main address. */
export default function ToMainLogin() {
  useEffect(() => {
    window.location.replace(posUrl("/login"));
  }, []);
  return <div className="flex min-h-screen items-center justify-center text-sm text-secondary-500">Opening sign in...</div>;
}
