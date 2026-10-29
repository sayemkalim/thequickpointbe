const ApiResponse = require("../utils/ApiResponse");

const rateLimitStore = new Map();

/**
 * Clean up expired rate limit entries every 5 minutes
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Creates an in-memory sliding window rate limiter
 * @param {Object} options
 * @param {number} options.windowMs - Time window in milliseconds (default: 10 mins)
 * @param {number} options.max - Maximum requests allowed in window (default: 5)
 * @param {string} options.message - Error message when rate limited
 * @param {Function} [options.keyGenerator] - Custom key generator function
 */
function createRateLimiter({
  windowMs = 10 * 60 * 1000,
  max = 5,
  message = "Too many requests. Please try again later.",
  keyGenerator = (req) => req.body?.phone || req.body?.phoneNumber || req.ip,
}) {
  return (req, res, next) => {
    // In automated testing, skip rate limit unless explicitly enabled
    if (process.env.NODE_ENV === "test" && !req.headers["x-test-rate-limit"]) {
      return next();
    }

    const key = keyGenerator(req);
    if (!key) return next();

    const now = Date.now();
    let record = rateLimitStore.get(key);

    if (!record || now > record.resetTime) {
      record = {
        count: 1,
        resetTime: now + windowMs,
      };
      rateLimitStore.set(key, record);
      return next();
    }

    record.count += 1;

    if (record.count > max) {
      const waitSeconds = Math.ceil((record.resetTime - now) / 1000);
      return res.status(429).json(
        new ApiResponse(
          429,
          { retryAfterSeconds: waitSeconds },
          `${message} Please retry in ${waitSeconds} seconds.`,
          false
        )
      );
    }

    next();
  };
}

const otpSendLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 3, // max 3 OTP requests per 10 mins
  message: "Too many OTP requests for this number.",
});

const otpVerifyLimiter = createRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 5, // max 5 verify attempts per 10 mins
  message: "Too many incorrect OTP attempts.",
});

module.exports = {
  createRateLimiter,
  otpSendLimiter,
  otpVerifyLimiter,
};
