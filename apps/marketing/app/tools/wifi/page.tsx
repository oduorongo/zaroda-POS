import { redirect } from "next/navigation";

export default function WifiToolPage() {
  redirect("/tools/qr?mode=wifi");
}
