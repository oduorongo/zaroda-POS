"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { apiDelete, apiGet, apiPatch, apiPost, apiUploadFile, ApiError } from "../../../../lib/api";
import { shrinkPhoto } from "../../../../lib/resize-image";
import { getSession, clearSession, isBackofficeRole, type Session } from "../../../../lib/auth";
import { Nav } from "../../../../components/nav";
import { PageHeader } from "../../../../components/page-header";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Label, LoadingState } from "@zaroda/ui";

interface Variant {
  id: string;
  sku: string;
  name?: string | null;
  price: string;
  quantityMode: "COUNT" | "WEIGHT";
}

interface Product {
  id: string;
  name: string;
  onlineVisible: boolean;
  onlineDescription: string | null;
  variants: Variant[];
}

interface ProductImage {
  id: string;
  url: string;
  sortOrder: number;
}

// Mirrors ProductImagesService's limits so the obvious mistakes are caught
// before uploading; the server still enforces them. Photos are shrunk in the browser first
// (see lib/resize-image.ts), so a large original is fine - only the shrunk file must fit MAX_BYTES.
const MAX_IMAGES = 5;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ORIGINAL_BYTES = 30 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * A product's online listing: whether it shows in the shop, its
 * buyer-facing description, and photos. Price and stock aren't edited
 * here - they come from the product's variants and the shop's fulfilment
 * branch, the same numbers the till uses.
 */
export default function ProductOnlineListingPage() {
  const params = useParams<{ productId: string }>();
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const [session, setSessionState] = useState<Session | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [images, setImages] = useState<ProductImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [onlineVisible, setOnlineVisible] = useState(false);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  useEffect(() => {
    const s = getSession();
    if (!s) {
      router.replace("/login");
      return;
    }
    if (!isBackofficeRole(s.role)) {
      clearSession();
      router.replace("/login");
      return;
    }
    setSessionState(s);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, params.productId]);

  async function load() {
    setLoading(true);
    try {
      const [productResult, imagesResult] = await Promise.all([
        apiGet<Product>(`/products/${params.productId}`),
        apiGet<ProductImage[]>(`/products/${params.productId}/images`),
      ]);
      setProduct(productResult);
      setOnlineVisible(productResult.onlineVisible);
      setDescription(productResult.onlineDescription ?? "");
      setImages(imagesResult);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not load this product.");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const result = await apiPatch<Product>(`/products/${params.productId}`, {
        onlineVisible,
        onlineDescription: description.trim(),
      });
      setProduct((p) => (p ? { ...p, onlineVisible: result.onlineVisible, onlineDescription: result.onlineDescription } : p));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  async function uploadPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    setPhotoError(null);
    const chosen = Array.from(files).slice(0, MAX_IMAGES - images.length);
    for (const file of chosen) {
      if (!ALLOWED_TYPES.includes(file.type)) {
        setPhotoError(`${file.name}: photos must be JPEG, PNG or WebP.`);
        return;
      }
      if (file.size > MAX_ORIGINAL_BYTES) {
        setPhotoError(`${file.name}: that photo is too large.`);
        return;
      }
    }
    setUploading(true);
    try {
      for (const original of chosen) {
        const file = await shrinkPhoto(original);
        if (file.size > MAX_BYTES) throw new Error(`${original.name}: photos must be 5MB or smaller.`);
        const image = await apiUploadFile<ProductImage>(`/products/${params.productId}/images`, file);
        setImages((current) => [...current, image]);
      }
    } catch (err) {
      setPhotoError(err instanceof Error ? err.message : "Could not upload the photo.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
      if (cameraInput.current) cameraInput.current.value = "";
    }
  }

  async function makeCover(imageId: string) {
    setPhotoError(null);
    try {
      setImages(await apiPost<ProductImage[]>(`/products/${params.productId}/images/${imageId}/cover`, {}));
    } catch (err) {
      setPhotoError(err instanceof ApiError ? err.message : "Could not change the cover photo.");
    }
  }

  async function removePhoto(imageId: string) {
    if (!confirm("Delete this photo?")) return;
    setPhotoError(null);
    try {
      await apiDelete(`/products/${params.productId}/images/${imageId}`);
      setImages((current) => current.filter((i) => i.id !== imageId));
    } catch (err) {
      setPhotoError(err instanceof ApiError ? err.message : "Could not delete the photo.");
    }
  }

  if (!session) return null;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Nav session={session} />
      <PageHeader />
      <main className="mx-auto max-w-3xl space-y-6 p-6">
        <Link href="/products" className="text-sm text-primary-600 hover:underline">
          ← Products
        </Link>

        {loading && <LoadingState label="Loading product..." />}
        {error && <p className="text-sm text-error-600">{error}</p>}

        {!loading && product && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-xl font-bold">{product.name}</h1>
              {product.onlineVisible ? <Badge variant="success">Shown online</Badge> : <Badge variant="neutral">Not online</Badge>}
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Online listing</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={onlineVisible} onChange={(e) => setOnlineVisible(e.target.checked)} className="h-4 w-4" />
                  Show this product in my online shop
                </label>
                {onlineVisible && product.variants.length === 0 && (
                  <p className="text-sm text-warning-700">
                    This product has no variants yet, so it has no price. Buyers will only see it once you add one on the Products page.
                  </p>
                )}
                <div>
                  <Label>Description for buyers</Label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={4}
                    maxLength={2000}
                    placeholder="Size, material, what's in the pack, how to use it..."
                    className="mt-1 w-full rounded-md border border-border bg-surface p-2 text-sm"
                  />
                </div>
                {product.variants.length > 0 && (
                  <div className="text-sm">
                    <p className="text-xs text-secondary-500">Online prices (from your variants)</p>
                    <ul className="mt-1 space-y-0.5">
                      {product.variants.map((v) => (
                        <li key={v.id} className="flex justify-between">
                          <span>{v.name?.trim() || v.sku}</span>
                          <span className="font-mono">
                            KES {Number(v.price).toFixed(2)}
                            {v.quantityMode === "WEIGHT" && <span className="text-secondary-500"> /unit</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {saveError && <p className="text-sm text-error-600">{saveError}</p>}
                {saved && <p className="text-sm text-success-600">Saved.</p>}
                <Button onClick={() => void save()} disabled={saving}>
                  {saving ? "Saving..." : "Save"}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Photos</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-secondary-600">
                  Up to {MAX_IMAGES} photos, JPEG, PNG or WebP, 5MB each. The first photo is the cover buyers see in the shop.
                </p>
                {images.length > 0 && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {images.map((image, index) => (
                      <div key={image.id} className="overflow-hidden rounded-md border border-border">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={image.url} alt={`${product.name} photo ${index + 1}`} className="aspect-square w-full object-cover" />
                        <div className="flex items-center justify-between p-2 text-xs">
                          {index === 0 ? (
                            <Badge variant="primary">Cover</Badge>
                          ) : (
                            <button onClick={() => void makeCover(image.id)} className="text-primary-600 hover:underline">
                              Make cover
                            </button>
                          )}
                          <button onClick={() => void removePhoto(image.id)} className="text-error-600 hover:underline">
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {photoError && <p className="text-sm text-error-600">{photoError}</p>}
                {images.length < MAX_IMAGES && (
                  <>
                    <input
                      ref={fileInput}
                      type="file"
                      accept={ALLOWED_TYPES.join(",")}
                      multiple
                      className="hidden"
                      onChange={(e) => void uploadPhotos(e.target.files)}
                    />
                    {/* capture opens the phone's camera directly; on a computer it behaves like a normal file picker. */}
                    <input
                      ref={cameraInput}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => void uploadPhotos(e.target.files)}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button variant="outline" onClick={() => cameraInput.current?.click()} disabled={uploading}>
                        {uploading ? "Preparing..." : "Take photo"}
                      </Button>
                      <Button variant="outline" onClick={() => fileInput.current?.click()} disabled={uploading}>
                        {uploading ? "Uploading..." : "Add photos"}
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
