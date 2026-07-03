export function calculateCheckoutTotal(cart) {
  const subtotalCents = cart.items.reduce(
    (sum, item) => sum + item.unit_price_cents * item.quantity,
    0,
  );
  const discountCents = 0;
  const taxableSubtotalCents = cart.items
    .filter((item) => item.taxable)
    .reduce((sum, item) => sum + item.unit_price_cents * item.quantity, 0);
  const taxCents = Math.round((taxableSubtotalCents * cart.tax_rate_bps) / 10_000);

  return {
    subtotal_cents: subtotalCents,
    discount_cents: discountCents,
    tax_cents: taxCents,
    total_cents: subtotalCents - discountCents + taxCents,
  };
}
