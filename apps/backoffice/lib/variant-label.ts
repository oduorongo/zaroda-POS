/** How a product option reads in a list: "Bread - Large loaf 800g", or "Bread (BREAD-400G)" when it has no name of its own. */
export function variantLabel(productName: string, variant: { name?: string | null; sku: string }): string {
  const option = variant.name?.trim();
  if (!option) return `${productName} (${variant.sku})`;
  return option.toLowerCase().startsWith(productName.toLowerCase()) ? option : `${productName} - ${option}`;
}
