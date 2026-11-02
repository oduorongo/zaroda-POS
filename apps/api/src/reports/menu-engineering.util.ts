// Menu engineering (Kasavana & Smith): each dish is placed by how often it sells against the others and by how much it
// earns per plate against the menu's average. Plain functions, tested without a database.

export type MenuClass = 'STAR' | 'PLOWHORSE' | 'PUZZLE' | 'DOG';

export interface DishSales {
  variantId: string;
  name: string;
  quantity: number;
  /** Sales before tax. */
  revenue: number;
  /** Cost of what was sold, or null when a cost (or an ingredient's cost) is not set. */
  cost: number | null;
}

export interface DishResult extends DishSales {
  mixPct: number;
  avgPrice: number;
  unitCost: number | null;
  unitMargin: number | null;
  totalMargin: number | null;
  popular: boolean;
  profitable: boolean | null;
  menuClass: MenuClass | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export const ADVICE: Record<MenuClass, string> = {
  STAR: 'Keep it as it is and give it the best place on the menu.',
  PLOWHORSE: 'Sells well but earns little: raise the price a little or make the portion or recipe cheaper.',
  PUZZLE: 'Earns well but few order it: move it up the menu, rename it or have staff suggest it.',
  DOG: 'Sells little and earns little: change it or take it off the menu.',
};

/**
 * Popular = its share of plates sold is at least 70% of an equal share (1 / number of dishes). Profitable = it earns at least the
 * menu's average margin per plate (all plates of dishes with a known cost). A dish with no cost gets no class.
 */
export function engineerMenu(dishes: DishSales[]) {
  const rows = dishes.filter((d) => d.quantity > 0);
  const totalQty = rows.reduce((s, d) => s + d.quantity, 0);
  const popularAt = rows.length ? 0.7 / rows.length : 0;
  const costed = rows.filter((d) => d.cost !== null);
  const costedQty = costed.reduce((s, d) => s + d.quantity, 0);
  const avgMargin = costedQty ? costed.reduce((s, d) => s + d.revenue - (d.cost as number), 0) / costedQty : null;

  const out: DishResult[] = rows.map((d) => {
    const mix = totalQty ? d.quantity / totalQty : 0;
    const unitCost = d.cost === null ? null : d.cost / d.quantity;
    const unitMargin = unitCost === null ? null : d.revenue / d.quantity - unitCost;
    const popular = mix >= popularAt;
    const profitable = unitMargin === null || avgMargin === null ? null : unitMargin >= avgMargin - 1e-9;
    const menuClass: MenuClass | null =
      profitable === null ? null : popular ? (profitable ? 'STAR' : 'PLOWHORSE') : profitable ? 'PUZZLE' : 'DOG';
    return {
      ...d,
      revenue: round2(d.revenue),
      cost: d.cost === null ? null : round2(d.cost),
      mixPct: round2(mix * 100),
      avgPrice: round2(d.revenue / d.quantity),
      unitCost: unitCost === null ? null : round2(unitCost),
      unitMargin: unitMargin === null ? null : round2(unitMargin),
      totalMargin: d.cost === null ? null : round2(d.revenue - d.cost),
      popular,
      profitable,
      menuClass,
    };
  });

  const count = (c: MenuClass) => out.filter((r) => r.menuClass === c).length;
  return {
    dishes: out.sort((a, b) => b.quantity - a.quantity),
    totalPlates: round2(totalQty),
    popularAtPct: round2(popularAt * 100),
    avgMargin: avgMargin === null ? null : round2(avgMargin),
    summary: { STAR: count('STAR'), PLOWHORSE: count('PLOWHORSE'), PUZZLE: count('PUZZLE'), DOG: count('DOG'), NO_COST: out.filter((r) => r.menuClass === null).length },
  };
}
