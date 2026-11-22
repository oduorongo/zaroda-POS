import Link from "next/link";
import { ShambaPublicFrame } from "../../../components/shamba/frame";
import { SHAMBA_BRAND } from "../../../lib/shamba";

const STEPS: [string, string][] = [
  ["1. Create your farm", "Sign up with your farm's name. You get 14 days of the Farmer plan free, no M-Pesa needed."],
  ["2. Draw your farm", "Under Layout, add the parts of your farm: blocks, fields and paddocks with their acres, cow sheds and pens, poultry houses, ponds, stores and the feed mill. Parts can sit inside others (Field 3 in Block B)."],
  ["3. Name your enterprises", "Under Enterprises, add each line of business - Dairy herd, Layers, Maize long rains, Feed mill - and the parts of the farm each uses. Costs and income are tagged to an enterprise so you can see which one makes money."],
  ["4. Give your team their jobs", "Add staff in the back office, then under Staff give each person their farm role: farm manager, herdsman, vet, crops officer, feed miller, storekeeper, sales or auditor. A herdsman can be limited to his sheds; a crops officer to her fields."],
  ["5. Keep records every day", "Coming next: animals, breeding, treatments and vaccinations, milk and eggs, crops, feed mixing and selling your produce."],
];

export default function ShambaGuide() {
  return (
    <ShambaPublicFrame>
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-3xl font-bold" style={{ color: SHAMBA_BRAND.navy }}>Getting started with Zaroda Shamba</h1>
        <div className="mt-6 space-y-4">
          {STEPS.map(([title, text]) => (
            <section key={title} className="rounded-xl border border-secondary-200 bg-white p-5 shadow-sm">
              <h2 className="font-semibold" style={{ color: SHAMBA_BRAND.navy }}>{title}</h2>
              <p className="mt-1 text-sm text-secondary-700">{text}</p>
            </section>
          ))}
        </div>
        <p className="mt-6 text-sm text-secondary-600">
          Need help? WhatsApp <a href="https://wa.me/254781230805" className="underline">0781230805</a> or call 0724282065.{" "}
          <Link href="/shamba/signup" className="font-semibold underline" style={{ color: SHAMBA_BRAND.orange }}>
            Start free
          </Link>
        </p>
      </main>
    </ShambaPublicFrame>
  );
}
