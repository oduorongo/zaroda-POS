import { BadRequestException } from '@nestjs/common';
import { QuantityMode } from '@prisma/client';

/**
 * COUNT-mode variants (the default - each, pack, box) must move in whole
 * units; WEIGHT-mode variants (kg, litre, ...) can move in fractions - see
 * schema.prisma's QuantityMode comment. Every place a quantity crosses into
 * sales/inventory math calls this once it has resolved which variant (and
 * therefore which mode) it's dealing with - enforced here rather than at
 * the DTO layer since a DTO has no way to know which variantId it's
 * paired with until a service looks it up.
 */
export function assertQuantityMatchesMode(
  mode: QuantityMode,
  quantity: number,
  label = 'Quantity',
) {
  if (mode === QuantityMode.COUNT && !Number.isInteger(quantity)) {
    throw new BadRequestException(
      `${label} must be a whole number - this product is sold by count, not by weight`,
    );
  }
}
