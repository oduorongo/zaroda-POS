"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost, ApiError } from "../../lib/api";
import { getSession, type Session } from "../../lib/auth";
import { Nav } from "../../components/nav";
import { Button, Card, CardContent, Input, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Badge, EmptyState, LoadingState, ErrorState } from "@zaroda/ui";

interface Customer {
  id: string;
  name: string;
  phone: string | null;
  loyaltyPoints: number;
}

/**
 * Customer/loyalty management (back-office view of the POS terminal's
 * "attach customer" flow). Read-only on loyalty points by design - there's
 * no endpoint to adjust a balance directly (only sales earn/redeem points,
 * see SalesService), so this doesn't offer a fake "edit points" control.
 */
export default function CustomersPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSessionState(s);
    void load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function load(q: string) {
    setLoading(true);
    setError(null);
    try {
      setCustomers(await apiGet<Customer[]>(`/customers?search=${encodeURIComponent(q)}`));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load customers.");
    } finally {
      setLoading(false);
    }
  }

  async function createCustomer() {
    if (!name.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await apiPost("/customers", { name: name.trim(), phone: phone.trim() || undefined });
      setName("");
      setPhone("");
      await load(search);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Could not create customer.");
    } finally {
      setCreating(false);
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="mb-4 text-xl font-bold">Customers &amp; Loyalty</h1>

        <Card className="mb-6">
          <CardContent>
            <h2 className="mb-3 font-semibold">New customer</h2>
            <div className="flex flex-wrap gap-2">
              <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="flex-1" />
              <Input placeholder="Phone (optional)" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-48" />
              <Button onClick={() => void createCustomer()} disabled={creating || !name.trim()}>
                {creating ? "Creating..." : "Create"}
              </Button>
            </div>
            {createError && <p className="mt-2 text-sm text-error-600">{createError}</p>}
          </CardContent>
        </Card>

        <div className="mb-4 flex gap-2">
          <Input
            placeholder="Search by name or phone..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              void load(e.target.value);
            }}
          />
        </div>

        {loading && <LoadingState label="Loading customers..." />}
        {!loading && error && <ErrorState description={error} />}
        {!loading && !error && customers.length === 0 && (
          <EmptyState title="No customers yet" description="Customers are created here or attached to a sale at the till." />
        )}
        {!loading && !error && customers.length > 0 && (
          <Card>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Phone</TableHeaderCell>
                  <TableHeaderCell>Loyalty points</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {customers.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-secondary-500">{c.phone ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={c.loyaltyPoints > 0 ? "success" : "neutral"}>{c.loyaltyPoints} pts</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </main>
    </div>
  );
}
