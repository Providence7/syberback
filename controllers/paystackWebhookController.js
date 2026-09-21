// src/controllers/paystackWebhookController.js
import Order from '../models/order.js';

// ── ASSUMPTIONS: confirm against models/order.js ──────────────────────────────
const REFERENCE_FIELD  = 'paymentReference'; // Order field holding the Paystack reference
const EXPECTED_CURRENCY = 'NGN';
const toKobo = (naira) => Math.round(Number(naira) * 100);

// Signature is already verified by verifyPaystackWebhook before this runs.
// Status codes matter here: Paystack retries on any non-200, so
//   200 = handled or intentionally ignored (unknown reference, already paid, mismatch)
//   500 = transient failure (DB down); Paystack will retry
export async function handlePaystackWebhook(req, res) {
  let event;
  try {
    event = JSON.parse(req.rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ message: 'Invalid payload.' });
  }

  try {
    if (event.event === 'charge.success') {
      await onChargeSuccess(event.data || {});
    }
    // All other event types are acknowledged and ignored
    return res.sendStatus(200);
  } catch (error) {
    console.error(`[paystack-webhook] ${event?.event} failed`, error);
    return res.sendStatus(500);
  }
}

async function onChargeSuccess({ reference, amount, currency, status }) {
  if (status !== 'success' || !reference) return;

  const order = await Order.findOne({ [REFERENCE_FIELD]: reference });

  if (!order) {
    // Could be a charge from another product on the same Paystack account
    console.warn(`[paystack-webhook] no order for reference ${reference}`);
    return;
  }

  // Idempotent: Paystack can deliver the same event more than once
  if (order.paymentStatus === 'paid') return;

  // Never trust the reference alone: the paid amount must match the order
  if (currency !== EXPECTED_CURRENCY || amount !== toKobo(order.totalPrice)) {
    console.error(
      `[paystack-webhook] MISMATCH order=${order._id} ref=${reference} ` +
      `paid=${amount} ${currency} expected=${toKobo(order.totalPrice)} ${EXPECTED_CURRENCY}`
    );
    return; // left unpaid for manual review
  }

  // Atomic guard: two concurrent deliveries can't both flip the order
  const updated = await Order.findOneAndUpdate(
    { _id: order._id, paymentStatus: { $ne: 'paid' } },
    { paymentStatus: 'paid', paidAt: new Date() },
    { new: true }
  );

  if (updated?.status === 'cancelled') {
    console.warn(`[paystack-webhook] payment received for CANCELLED order ${order._id}: refund needed`);
  }
}