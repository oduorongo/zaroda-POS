"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiGet, apiPost, apiPut } from "../../../lib/api";
import { Card, ShambaAppFrame } from "../../../components/shamba/frame";
import { Btn, ErrorBox, errText } from "../../../components/shamba/livestock";
import { INPUT_KINDS, SHAMBA_INK, inputClass } from "../../../lib/shamba";

interface Input { productId: string; variantId: string | null; name: string; kind: string; unit: string; mode: "COUNT" | "WEIGHT"; cost: number | null; onHand: number; active: boolean }
interface ProductRow { id: string; name: string }
interface Supplier { id: string; name: string }

const kes = (n: number) => `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
const UNITS = ["bag", "kg", "litre", "packet", "bottle", "tin", "each"];

function AddInput({ onDone }: { onDone: () => void }) {
  const blank = { name: "", kind: "SEED", unit: "bag", mode: "COUNT" as "COUNT" | "WEIGHT", cost: "" };
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost("/farm/inputs", { ...f, cost: Number(f.cost || 0) });
      setF(blank);
      onDone();
    } catch (err) {
      setError(errText(err, "Could not add the input"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card title="Add an input">
      <form onSubmit={save} className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
        <label className="col-span-2">
          Name
          <input required className={inputClass} placeholder="e.g. H614D maize seed (2 kg)" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </label>
        <label>
          Kind
          <select className={inputClass} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            {Object.entries(INPUT_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label>
          Counted in
          <select className={inputClass} value={f.unit} onChange={(e) => { const unit = e.target.value; setF({ ...f, unit, mode: unit === "kg" || unit === "litre" ? "WEIGHT" : "COUNT" }); }}>
            {UNITS.map((u) => <option key={u}>{u}</option>)}
          </select>
        </label>
        <label>
          Cost of one {f.unit} (KES)
          <input type="number" min={0} step="0.01" className={inputClass} value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} />
        </label>
        <div className="col-span-2 sm:col-span-5">
          <ErrorBox error={error} />
          <Btn busy={busy}>Add input</Btn>
        </div>
      </form>
    </Card>
  );
}

function Receive({ input, suppliers, onDone }: { input: Input; suppliers: Supplier[]; onDone: (msg: string) => void }) {
  const [f, setF] = useState({ quantity: "", unitCost: input.cost != null ? String(input.cost) : "", supplierId: "", deliveryNote: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<{ receipt: { receiptNumber: string } }>(`/farm/inputs/${input.productId}/receive`, {
        quantity: Number(f.quantity),
        ...(f.unitCost !== "" ? { unitCost: Number(f.unitCost) } : {}),
        ...(f.supplierId ? { supplierId: f.supplierId } : {}),
        ...(f.deliveryNote.trim() ? { deliveryNote: f.deliveryNote.trim() } : {}),
      });
      onDone(`${f.quantity} ${input.unit} of ${input.name} received (${r.receipt?.receiptNumber ?? "goods received note"}).`);
    } catch (err) {
      setError(errText(err, "Could not record the delivery"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-background p-3 text-sm sm:grid-cols-4">
      <label>
        How many {input.unit}
        <input required type="number" min={0} step={input.mode === "WEIGHT" ? "0.001" : "1"} className={inputClass} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
      </label>
      <label>
        Paid for one (KES)
        <input type="number" min={0} step="0.01" className={inputClass} value={f.unitCost} onChange={(e) => setF({ ...f, unitCost: e.target.value })} />
      </label>
      <label>
        Supplier
        <select className={inputClass} value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}>
          <option value="">Not recorded</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <label>
        Delivery note / receipt no.
        <input className={inputClass} value={f.deliveryNote} onChange={(e) => setF({ ...f, deliveryNote: e.target.value })} />
      </label>
      <div className="col-span-2 sm:col-span-4">
        <ErrorBox error={error} />
        <Btn busy={busy}>Record delivery</Btn>
      </div>
    </form>
  );
}

function MoveExisting({ inputIds, onDone }: { inputIds: Set<string>; onDone: () => void }) {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [productId, setProductId] = useState("");
  const [kind, setKind] = useState("SEED");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    apiGet<ProductRow[]>("/products").then((p) => setProducts(Array.isArray(p) ? p : [])).catch(() => setProducts([]));
  }, []);
  const others = products.filter((p) => !inputIds.has(p.id));
  async function move() {
    if (!productId) return;
    setError(null);
    try {
      await apiPut("/farm/inputs/mark", { productId, kind });
      setProductId("");
      onDone();
    } catch (err) {
      setError(errText(err, "Could not move it"));
    }
  }
  if (!others.length) return null;
  return (
    <Card title="Already added it as a product?">
      <p className="mb-2 text-sm text-secondary-600">Move a seed, fertiliser, spray, drug or bought feed you added under Farm products into Farm inputs.</p>
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label>
          Item
          <select className={inputClass} value={productId} onChange={(e) => setProductId(e.target.value)}>
            <option value="">Choose...</option>
            {others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label>
          Kind
          <select className={inputClass} value={kind} onChange={(e) => setKind(e.target.value)}>
            {Object.entries(INPUT_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <Btn type="button" disabled={!productId} onClick={() => void move()}>Move to inputs</Btn>
      </div>
      <ErrorBox error={error} />
    </Card>
  );
}

function InputsPage({ manager }: { manager: boolean }) {
  const [inputs, setInputs] = useState<Input[] | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const load = () => apiGet<Input[]>("/farm/inputs").then(setInputs).catch((err) => setError(errText(err, "Could not load the inputs")));
  useEffect(() => {
    void load();
    apiGet<Supplier[]>("/suppliers").then((s) => setSuppliers(Array.isArray(s) ? s : [])).catch(() => {});
  }, []);

  async function back(productId: string) {
    if (!window.confirm("Put this item back with the farm's products?")) return;
    try {
      await apiPut("/farm/inputs/mark", { productId, kind: null });
      await load();
    } catch (err) {
      setError(errText(err, "Could not move it"));
    }
  }

  const groups = Object.keys(INPUT_KINDS).map((k) => [k, (inputs ?? []).filter((i) => i.kind === k)] as const).filter(([, l]) => l.length);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: SHAMBA_INK }}>Farm inputs</h1>
        <p className="text-sm text-secondary-600">
          What comes into the farm: seed, fertiliser, sprays, vet drugs, bought feed and feed ingredients. Record each delivery here, then use it on the{" "}
          <Link href="/shamba/crops" className="underline">crops</Link>, in <Link href="/shamba/feed" className="underline">feed</Link> and in{" "}
          <Link href="/shamba/health" className="underline">health</Link>. What the farm produces (milk, eggs, harvests, home-mixed feed) is under{" "}
          <Link href="/products" className="underline">Farm products &amp; prices</Link>.
        </p>
      </div>
      <ErrorBox error={error} />
      {done && <p className="rounded-lg bg-success-50 p-2 text-sm text-success-700">{done}</p>}
      {manager && <AddInput onDone={() => void load()} />}
      {inputs && inputs.length === 0 && <p className="text-sm text-secondary-500">No inputs yet. Add the seed, fertiliser and sprays you buy, then press Add stock on each when it is delivered.</p>}
      {groups.map(([kind, list]) => (
        <Card key={kind} title={INPUT_KINDS[kind]}>
          <ul className="divide-y divide-border">
            {list.map((i) => (
              <li key={i.productId} className="py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <span className="font-semibold">{i.name}</span>
                    <span className="block text-xs text-secondary-500">{i.cost != null ? `${kes(i.cost)} a ${i.unit}` : "No cost set"}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className={i.onHand <= 0 ? "font-semibold text-red-600" : ""}>
                      {i.onHand.toLocaleString("en-KE")} {i.unit} in store
                    </span>
                    {manager && (
                      <>
                        <button type="button" className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white" style={{ background: "#f5820a" }} onClick={() => setOpen(open === i.productId ? null : i.productId)}>
                          {open === i.productId ? "Close" : "Add stock"}
                        </button>
                        <button type="button" className="text-xs text-secondary-500 underline" onClick={() => void back(i.productId)}>Not an input</button>
                      </>
                    )}
                  </span>
                </div>
                {open === i.productId && <Receive input={i} suppliers={suppliers} onDone={(m) => { setOpen(null); setDone(m); void load(); }} />}
              </li>
            ))}
          </ul>
        </Card>
      ))}
      {manager && inputs && <MoveExisting inputIds={new Set(inputs.map((i) => i.productId))} onDone={() => void load()} />}
    </div>
  );
}

export default function Page() {
  return <ShambaAppFrame>{(session) => <InputsGate owner={session.role === "OWNER" || session.role === "MANAGER"} />}</ShambaAppFrame>;
}

/** Owners and managers, and the farm's storekeepers and managers by farm role, keep the inputs and take deliveries. */
function InputsGate({ owner }: { owner: boolean }) {
  const [roles, setRoles] = useState<string[]>([]);
  useEffect(() => {
    apiGet<{ me: { isOwner: boolean; roles: string[] } }>("/farm/overview").then((o) => setRoles(o.me.isOwner ? ["FARM_OWNER"] : o.me.roles), () => setRoles([]));
  }, []);
  return <InputsPage manager={owner || roles.some((r) => ["FARM_OWNER", "FARM_MANAGER", "STOREKEEPER"].includes(r))} />;
}
