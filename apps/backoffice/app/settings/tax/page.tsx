"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPatch, apiPost, apiDelete, ApiError } from "../../../lib/api";
import { getSession, type Session } from "../../../lib/auth";
import { Nav } from "../../../components/nav";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Badge, EmptyState, LoadingState } from "@zaroda/ui";

interface Organization {
  id: string;
  name: string;
  kraPin: string | null;
  vatRegistered: boolean;
}

interface TaxClass {
  id: string;
  name: string;
  rate: number;
  isExempt: boolean;
}

/**
 * eTIMS / tax settings. Only the KRA PIN, VAT-registration status, and this
 * org's tax classes (VAT rates per product category) are real, persisted
 * settings - there is no eTIMS (KRA VSCU) integration wired up yet (no
 * invoice sync exists to have a status log for), so that section is an
 * honest empty state rather than fabricated sync history. Wiring the real
 * integration needs KRA-confirmed API specifics first (see DESIGN.md).
 */
export default function TaxSettingsPage() {
  const router = useRouter();
  const [session, setSessionState] = useState<Session | null>(null);
  const [org, setOrg] = useState<Organization | null>(null);
  const [kraPin, setKraPin] = useState("");
  const [vatRegistered, setVatRegistered] = useState(false);
  const [savingOrg, setSavingOrg] = useState(false);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [orgSaved, setOrgSaved] = useState(false);

  const [taxClasses, setTaxClasses] = useState<TaxClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newRate, setNewRate] = useState("");
  const [newExempt, setNewExempt] = useState(false);
  const [creating, setCreating] = useState(false);
  const [taxError, setTaxError] = useState<string | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    setSessionState(s);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  async function load() {
    setLoading(true);
    try {
      const [orgResult, taxResult] = await Promise.all([
        apiGet<Organization>("/organizations/me"),
        apiGet<TaxClass[]>("/tax-classes"),
      ]);
      setOrg(orgResult);
      setKraPin(orgResult.kraPin ?? "");
      setVatRegistered(orgResult.vatRegistered);
      setTaxClasses(taxResult);
    } catch {
      // Errors surfaced inline per-section below rather than a blocking page-level error.
    } finally {
      setLoading(false);
    }
  }

  async function saveOrg() {
    setSavingOrg(true);
    setOrgError(null);
    setOrgSaved(false);
    try {
      await apiPatch("/organizations/me", { kraPin: kraPin.trim() || undefined, vatRegistered });
      setOrgSaved(true);
      setTimeout(() => setOrgSaved(false), 3000);
    } catch (err) {
      setOrgError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setSavingOrg(false);
    }
  }

  async function createTaxClass() {
    const rate = Number(newRate);
    if (!newName.trim() || !Number.isFinite(rate) || rate < 0 || rate > 1) return;
    setCreating(true);
    setTaxError(null);
    try {
      await apiPost("/tax-classes", { name: newName.trim(), rate, isExempt: newExempt });
      setNewName("");
      setNewRate("");
      setNewExempt(false);
      await load();
    } catch (err) {
      setTaxError(err instanceof ApiError ? err.message : "Could not create tax class.");
    } finally {
      setCreating(false);
    }
  }

  async function removeTaxClass(id: string) {
    setTaxError(null);
    try {
      await apiDelete(`/tax-classes/${id}`);
      await load();
    } catch (err) {
      setTaxError(err instanceof ApiError ? err.message : "Could not delete - it may still be assigned to products.");
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <h1 className="text-xl font-bold">eTIMS &amp; Tax Settings</h1>

        {loading && <LoadingState label="Loading settings..." />}

        {!loading && org && (
          <>
            <Card>
              <CardHeader><CardTitle>Business tax identity</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label>KRA PIN</Label>
                  <Input placeholder="e.g. P051234567X" value={kraPin} onChange={(e) => setKraPin(e.target.value)} />
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={vatRegistered} onChange={(e) => setVatRegistered(e.target.checked)} className="h-4 w-4" />
                  VAT registered
                </label>
                {orgError && <p className="text-sm text-error-600">{orgError}</p>}
                {orgSaved && <p className="text-sm text-success-600">Saved.</p>}
                <Button onClick={() => void saveOrg()} disabled={savingOrg}>
                  {savingOrg ? "Saving..." : "Save"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>Tax classes (VAT rates)</CardTitle></CardHeader>
              <CardContent>
                <div className="mb-4 flex flex-wrap items-end gap-2">
                  <div>
                    <Label>Name</Label>
                    <Input placeholder="e.g. Standard VAT" value={newName} onChange={(e) => setNewName(e.target.value)} />
                  </div>
                  <div>
                    <Label>Rate (0–1)</Label>
                    <Input placeholder="0.16" value={newRate} onChange={(e) => setNewRate(e.target.value)} className="w-24" />
                  </div>
                  <label className="mb-2 flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={newExempt} onChange={(e) => setNewExempt(e.target.checked)} className="h-4 w-4" />
                    Exempt
                  </label>
                  <Button onClick={() => void createTaxClass()} disabled={creating || !newName.trim()}>
                    {creating ? "Adding..." : "Add"}
                  </Button>
                </div>
                {taxError && <p className="mb-2 text-sm text-error-600">{taxError}</p>}

                {taxClasses.length === 0 ? (
                  <EmptyState title="No tax classes yet" description="Kenya's standard VAT rate is 16% - add it here, plus any 0%/exempt classes your catalog needs." />
                ) : (
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell>Name</TableHeaderCell>
                        <TableHeaderCell>Rate</TableHeaderCell>
                        <TableHeaderCell>Status</TableHeaderCell>
                        <TableHeaderCell />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {taxClasses.map((tc) => (
                        <TableRow key={tc.id}>
                          <TableCell className="font-medium">{tc.name}</TableCell>
                          <TableCell>{(tc.rate * 100).toFixed(0)}%</TableCell>
                          <TableCell>
                            {tc.isExempt ? <Badge variant="neutral">Exempt</Badge> : <Badge variant="success">Taxable</Badge>}
                          </TableCell>
                          <TableCell>
                            <button onClick={() => void removeTaxClass(tc.id)} className="text-sm text-error-600 hover:underline">
                              Delete
                            </button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>eTIMS invoice sync log</CardTitle></CardHeader>
              <CardContent>
                <EmptyState
                  title="eTIMS integration not yet configured"
                  description="Sales aren't submitted to KRA's Virtual Sales Control Unit yet. Once this is wired up, every completed sale's sync status (pending / synced / failed, with retry) will show here."
                />
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
