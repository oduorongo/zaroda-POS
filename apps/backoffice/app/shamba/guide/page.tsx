import Link from "next/link";
import { ShambaPublicFrame } from "../../../components/shamba/frame";
import { SHAMBA_BRAND, SHAMBA_INK } from "../../../lib/shamba";

const STEPS: [string, string][] = [
  ["1. Create your farm", "Sign up with your farm's name. You get 14 days of the Farmer plan free, no M-Pesa needed."],
  ["2. Draw your farm", "Under Layout, add the parts of your farm: blocks, fields and paddocks with their acres, cow sheds and pens, poultry houses, ponds, stores and the feed mill. Parts can sit inside others (Field 3 in Block B)."],
  ["3. Name your enterprises", "Under Enterprises, add each line of business - Dairy herd, Layers, Maize long rains, Feed mill - and the parts of the farm each uses. Costs and income are tagged to an enterprise so you can see which one makes money."],
  ["4. Give your team their jobs", "Add staff in the back office, then under Staff give each person their farm role: farm manager, herdsman, vet, crops officer, feed miller, storekeeper, sales or auditor. A herdsman can be limited to his sheds; a crops officer to her fields."],
  ["5. Farm inputs and farm products", "Two lists. Farm inputs (Production > Farm inputs) are what comes into the farm: seed, fertiliser, sprays, vet drugs, bought feed and feed ingredients. Add each with its unit and cost, and press Received for every delivery (how many, the price paid, the supplier). Farm products (Selling > Farm products & prices) are what the farm produces to sell or to make other products: milk, eggs, harvests, home-mixed feed. Field work and spraying pick from farm inputs; harvests, milk and eggs go into farm products. Already added a seed or fertiliser as a product? Move it on the Farm inputs page."],
  ["6. Add your animals", "Animals: add cows, goats and pigs one by one with their ear tag, and poultry as a flock with a head count. Add your drugs with the withdrawal days from the label."],
  ["7. Health and breeding", "On an animal: record sickness, treatments, AI or service, births (the calf gets its own record) and weights. Treated animals show 'Withheld' until their milk or meat can be sold. Health lists what is due; on Mkulima and up, set vaccination programmes and get SMS and email reminders."],
  ["8. Milk and eggs", "Under Yields & produce > Settings, make (or choose) the milk and egg products once. Then on Milk, pick the milking (morning, midday, evening) and type each cow's litres; on Eggs, each flock's good, cracked and small eggs, feed and deaths. Milk and eggs for sale go straight into stock for the till. Milk or eggs from treated animals are withheld and never reach stock, so they cannot be sold."],
  ["9. Yields and other produce", "Yields & produce shows milk, eggs and lay % by day, week and month, and each cow's litres a day. Record honey, manure, fish and other produce there too - into stock if you sell it."],
  ["10. Selling your produce", "Milk, eggs and other produce are sold at the till like any shop item. Open the till (Selling > Open the till, or pos.zarodashop.com), tap your PIN, pick Fresh milk or Eggs, type the litres or trays and take cash or M-Pesa; the receipt prints and the stock goes down. Change prices under Selling > Products & prices; see what sold under Sales and what is left under Stock. The farm home shows the milk and eggs ready to sell."],
  ["11. Crops", "Crops: press New season, pick the field, the crop and its acres, and the seed lot (KEPHIS). On the season, record field work - land preparation, planting, weeding, top dressing, irrigation - with fertiliser or seed taken straight from stock and the labour paid. A spray needs the chemical and the pre-harvest days from its label: harvest is refused until they pass. Record each harvest in kg, bags or tonnes, into stock if you sell it, and see the yield and cost per acre and per kg."],
  ["12. Feed", "Feed: under Rations, write each home-mixed feed's recipe from stock ingredients (maize germ, sunflower cake, omena, DCP, premix). Under Mixing, the feed miller records each batch and the kg weighed out; nothing moves in stock until a farm manager approves it - then the ingredients come off and the feed goes in at its real cost per kg. A wrong batch is reversed, never edited. Record each day's feeding per flock, group or cow; the Overview shows feed cost per litre of milk, per egg and per head, and warns when a feed has less than a week left."],
  ["13. Workers and wages", "Workers & wages (Farmer plan and up): add casual workers with their M-Pesa number and pay a day - they never count as users. Mark the muster roll each day (present, half day, absent). A pay run works out each worker's pay from the muster with NSSF, SHIF, Housing Levy and PAYE at the rates in force; someone else approves it, then pay by M-Pesa from the farm's own payout account (or mark it paid in cash) and each worker gets a payslip by SMS. Paid days are fixed."],
  ["14. Buyers and credit", "Buyers & credit (Mkulima plan and up): add the co-op, hotels and schools you supply, with a credit limit and how many days they take to pay. Record each delivery (milk to the co-op with its slip number) and each payment; see what each buyer owes by age and print a statement. Going past a limit needs a farm manager. The till and deliveries refuse milk and eggs beyond what is fit for sale, so produce from treated animals cannot be sold. Tag products to enterprises to see sales per enterprise."],
  ["15. Reports and books", "Reports (farm managers and auditors): profit per enterprise, cost per litre of milk, per egg, per kg and per acre, the herd register, breeding calendar, health and withdrawal register, crop report, wages by worker and buyers who owe. Download any report to Excel or PDF, or print it; every PDF has the farm's name and who prepared it. Valuation (Money > Valuation, and on each animal) values livestock as assets (IAS 41): weight x market price less costs to sell, else cost, less a drop past prime age; milk, eggs and young show apart as profit. The total is carried in the books as Livestock. Wages, credit deliveries, buyer payments, feed fed and field inputs post to the farm's own books (Accounts) by themselves. The full guide is docs/farm/USER-GUIDE.md."],
];

export default function ShambaGuide() {
  return (
    <ShambaPublicFrame>
      <main className="mx-auto w-full max-w-3xl px-4 py-10">
        <h1 className="text-3xl font-bold" style={{ color: SHAMBA_INK }}>Getting started with Zaroda Shamba</h1>
        <div className="mt-6 space-y-4">
          {STEPS.map(([title, text]) => (
            <section key={title} className="rounded-xl border border-border bg-surface p-5 shadow-sm">
              <h2 className="font-semibold" style={{ color: SHAMBA_INK }}>{title}</h2>
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
