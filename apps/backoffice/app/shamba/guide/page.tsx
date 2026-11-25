import Link from "next/link";
import { ShambaPublicFrame } from "../../../components/shamba/frame";
import { SHAMBA_BRAND } from "../../../lib/shamba";

const STEPS: [string, string][] = [
  ["1. Create your farm", "Sign up with your farm's name. You get 14 days of the Farmer plan free, no M-Pesa needed."],
  ["2. Draw your farm", "Under Layout, add the parts of your farm: blocks, fields and paddocks with their acres, cow sheds and pens, poultry houses, ponds, stores and the feed mill. Parts can sit inside others (Field 3 in Block B)."],
  ["3. Name your enterprises", "Under Enterprises, add each line of business - Dairy herd, Layers, Maize long rains, Feed mill - and the parts of the farm each uses. Costs and income are tagged to an enterprise so you can see which one makes money."],
  ["4. Give your team their jobs", "Add staff in the back office, then under Staff give each person their farm role: farm manager, herdsman, vet, crops officer, feed miller, storekeeper, sales or auditor. A herdsman can be limited to his sheds; a crops officer to her fields."],
  ["5. Add your animals", "Animals: add cows, goats and pigs one by one with their ear tag, and poultry as a flock with a head count. Add your drugs with the withdrawal days from the label."],
  ["6. Health and breeding", "On an animal: record sickness, treatments, AI or service, births (the calf gets its own record) and weights. Treated animals show 'Withheld' until their milk or meat can be sold. Health lists what is due; on Mkulima and up, set vaccination programmes and get SMS and email reminders."],
  ["7. Milk and eggs", "Under Yields & produce > Settings, make (or choose) the milk and egg products once. Then on Milk, pick the milking (morning, midday, evening) and type each cow's litres; on Eggs, each flock's good, cracked and small eggs, feed and deaths. Milk and eggs for sale go straight into stock for the till. Milk or eggs from treated animals are withheld and never reach stock, so they cannot be sold."],
  ["8. Yields and other produce", "Yields & produce shows milk, eggs and lay % by day, week and month, and each cow's litres a day. Record honey, manure, fish and other produce there too - into stock if you sell it."],
  ["9. Selling your produce", "Milk, eggs and other produce are sold at the till like any shop item. Open the till (Selling > Open the till, or pos.zarodashop.com), tap your PIN, pick Fresh milk or Eggs, type the litres or trays and take cash or M-Pesa; the receipt prints and the stock goes down. Change prices under Selling > Products & prices; see what sold under Sales and what is left under Stock. The farm home shows the milk and eggs ready to sell."],
  ["10. Crops", "Crops: press New season, pick the field, the crop and its acres, and the seed lot (KEPHIS). On the season, record field work - land preparation, planting, weeding, top dressing, irrigation - with fertiliser or seed taken straight from stock and the labour paid. A spray needs the chemical and the pre-harvest days from its label: harvest is refused until they pass. Record each harvest in kg, bags or tonnes, into stock if you sell it, and see the yield and cost per acre and per kg."],
  ["11. Coming next", "Feed mixing, casual workers and selling on credit (co-ops, hotels, statements)."],
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
