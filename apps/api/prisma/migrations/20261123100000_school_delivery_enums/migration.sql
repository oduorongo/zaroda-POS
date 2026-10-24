-- School supplier: a new order status (some goods delivered, a balance to come) and a payment method for goods delivered on credit.
-- Kept apart from the next migration because a new enum value cannot be used in the transaction that adds it.
ALTER TYPE "SchoolOrderStatus" ADD VALUE 'PARTIALLY_DELIVERED';
ALTER TYPE "PaymentMethod" ADD VALUE 'ACCOUNT';
