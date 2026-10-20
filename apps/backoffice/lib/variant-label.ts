/** How a product option reads in a list: "Bread - Large loaf 800g", or "Bread (BREAD-400G)" when it has no name of its own. */
export function variantLabel(productName: string, variant: { name?: string | null; sku: string }): string {
  const option = variant.name?.trim();
  if (!option) return `${productName} (${variant.sku})`;
  return option.toLowerCase().startsWith(productName.toLowerCase()) ? option : `${productName} - ${option}`;
}

/** The option written without its code: "Bread - Large loaf 800g", or just the product name when the option has no name. */
export function variantTitleOf(productName: string, variant: { name?: string | null }): string {
  const option = variant.name?.trim();
  if (!option) return productName;
  return option.toLowerCase().startsWith(productName.toLowerCase()) ? option : `${productName} - ${option}`;
}
