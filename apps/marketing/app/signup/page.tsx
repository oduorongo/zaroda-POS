import type { Metadata } from "next";
import SignupClient from "./signup-client";

export const metadata: Metadata = {
  title: "Start your free trial — Zaroda POS",
  description: "Set up your first branch and register in minutes — 14-day free trial, no card required.",
  alternates: { canonical: "https://zarodashop.com/signup" },
};

export default function SignupPage() {
  return <SignupClient />;
}
