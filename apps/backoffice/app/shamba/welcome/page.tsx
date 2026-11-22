import Link from "next/link";
import { ShambaPublicFrame } from "../../../components/shamba/frame";
import { SHAMBA_BRAND } from "../../../lib/shamba";

const FEATURES: [string, string][] = [
  ["Livestock", "Every cow, goat, pig and flock: tags, breeding, calving, vaccinations, treatments and weights."],
  ["Milk and eggs", "Milk per cow per milking and eggs per flock per day, with trends you can act on."],
  ["Animal health", "Treatments with withdrawal periods - milk and meat from treated animals can't be sold by mistake."],
  ["Crops", "Fields, seasons, inputs, spraying and harvests, with yield and cost per acre."],
  ["Feed production", "Mix your own feed from your stock: rations, batches and the real cost per kg."],
  ["Sales and money", "Sell milk, eggs, animals and produce by cash, M-Pesa or credit, and see profit per enterprise."],
];

export default function ShambaWelcome() {
  return (
    <ShambaPublicFrame>
      <section style={{ background: SHAMBA_BRAND.navy }}>
        <div className="mx-auto max-w-6xl px-4 py-14 text-white">
          <p className="text-sm font-semibold uppercase tracking-wide" style={{ color: SHAMBA_BRAND.gold }}>
            Zaroda Shamba
          </p>
          <h1 className="mt-2 max-w-3xl text-3xl font-bold leading-tight sm:text-4xl">Run your farm from your phone - livestock, crops, feed and sales in one place.</h1>
          <p className="mt-4 max-w-2xl text-white/80">For small shambas and large farms across Kenya. Start free, and grow into it as your farm grows.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/shamba/signup" className="rounded-lg px-5 py-3 font-semibold text-white" style={{ background: SHAMBA_BRAND.orange }}>
              Start free - 14 days of Farmer
            </Link>
            <Link href="/shamba/pricing" className="rounded-lg border border-white/40 px-5 py-3 font-semibold text-white">
              See prices
            </Link>
          </div>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-4 py-10 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map(([title, text]) => (
          <div key={title} className="rounded-xl border border-secondary-200 bg-white p-5 shadow-sm">
            <h2 className="font-semibold" style={{ color: SHAMBA_BRAND.navy }}>{title}</h2>
            <p className="mt-1 text-sm text-secondary-600">{text}</p>
          </div>
        ))}
      </section>
    </ShambaPublicFrame>
  );
}
