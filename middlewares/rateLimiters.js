import rateLimit from 'express-rate-limit';

const MIN = 60 * 1000;
const tooMany = { message: 'Too many attempts. Please try again later.' };

// Bucket by email so rotating IPs doesn't bypass the limit
const emailKey = (req) =>
  String(req.body?.email || '').trim().toLowerCase() || 'no-email';

const make = (windowMs, limit, extra = {}) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: tooMany,
    ...extra,
  });

// Per-IP caps are generous (shared mobile IPs). The per-email caps are the
// real brute-force defence.
export const registerLimiter       = make(60 * MIN, 15);

export const loginIpLimiter        = make(15 * MIN, 50, { skipSuccessfulRequests: true });
export const loginEmailLimiter     = make(15 * MIN, 5,  { skipSuccessfulRequests: true, keyGenerator: emailKey });

export const verifyIpLimiter       = make(15 * MIN, 30);
export const verifyEmailLimiter    = make(15 * MIN, 5,  { keyGenerator: emailKey });

export const resetRequestIpLimiter    = make(60 * MIN, 30);
export const resetRequestEmailLimiter = make(60 * MIN, 3, { keyGenerator: emailKey });

export const resetPasswordLimiter  = make(15 * MIN, 30);