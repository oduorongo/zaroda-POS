/**
 * How a product option is written for people: "Bread - Large loaf 800g", or just "Bread" when the option has no name of its
 * own (a product with a single option usually does not need one). Used wherever a name is stored on an order, so an order
 * line reads the same a year later even if the option is renamed.
 */
export function variantTitle(productName: string, variantName: string | null | undefined): string {
  const option = variantName?.trim();
  if (!option) return productName;
  // Avoid "Bread - Bread" when the option name already starts with the product's name.
  if (option.toLowerCase().startsWith(productName.toLowerCase())) return option;
  return `${productName} - ${option}`;
}
