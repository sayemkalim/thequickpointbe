/**
 * Webz Media SMS Gateway Provider
 * Supports WebzMedia Token Key API (http://sms.webzmedia.co.in/http-tokenkeyapi.php)
 * with backward compatibility for legacy HTTP API (http-api.php).
 */
class WebzmediaSmsProvider {
  constructor(config = {}) {
    // 1. Authentication Token Key (Token Key API)
    this.authKey = (
      config.authKey ||
      config.authenticKey ||
      process.env.WEBZMEDIA_AUTH_KEY ||
      process.env.SMS_AUTH_KEY ||
      ""
    ).trim();

    // 2. Legacy Credentials (username/password)
    this.username = (
      config.username ||
      process.env.WEBZMEDIA_USERNAME ||
      process.env.SMS_USERNAME ||
      ""
    ).trim();

    this.password = (
      config.password ||
      process.env.WEBZMEDIA_PASSWORD ||
      process.env.SMS_PASSWORD ||
      ""
    ).trim();

    // 3. Sender ID (Default: THQPNT)
    this.senderId = (
      config.senderId ||
      process.env.WEBZMEDIA_SENDER_ID ||
      process.env.SMS_SENDER_ID ||
      "THQPNT"
    ).trim();

    // 4. Route ID (Default: 16 for Token Key OTP Route, "default" for legacy)
    this.route = (
      config.route ||
      process.env.WEBZMEDIA_ROUTE ||
      (this.authKey ? "16" : "16")
    ).trim();

    // 5. Approved DLT Content Template ID (Default: 1107176249859819412)
    this.dltTemplateId = (
      config.dltTemplateId ||
      config.templateId ||
      process.env.WEBZMEDIA_DLT_TE_ID ||
      "1107176249859819412"
    ).trim();

    // 6. Base Gateway Endpoint
    const defaultUrl = this.authKey || (!this.username && !this.password)
      ? "http://sms.webzmedia.co.in/http-tokenkeyapi.php"
      : "http://sms.webzmedia.co.in/http-api.php";

    this.baseUrl = (
      config.baseUrl ||
      process.env.WEBZMEDIA_URL ||
      defaultUrl
    ).trim();
  }

  /**
   * Determine if Token Key mode is active
   */
  isTokenKeyMode() {
    return Boolean(this.authKey);
  }

  /**
   * Check if provider has minimal credentials configured
   */
  isConfigured() {
    return Boolean(this.authKey || (this.username && this.password));
  }

  /**
   * Format phone number to clean 10-digit Indian mobile
   * Webz Media HTTP gateway accepts 10-digit mobile number
   * @param {string} phone
   * @returns {string} 10-digit phone
   */
  formatPhoneNumber(phone) {
    if (!phone) return "";
    let cleaned = String(phone).replace(/\D/g, "");
    if (cleaned.length === 12 && cleaned.startsWith("91")) {
      cleaned = cleaned.substring(2);
    }
    if (cleaned.length > 10) {
      cleaned = cleaned.slice(-10);
    }
    return cleaned;
  }

  /**
   * Build the complete request URL with query parameters
   * @param {Object} options
   * @param {string} options.mobile - 10-digit recipient phone
   * @param {string} options.message - Message body
   * @param {string} [options.sender] - Optional sender ID override
   * @param {string} [options.templateId] - Optional DLT template ID override
   * @returns {string} Fully formed gateway URL
   */
  buildRequestUrl({ mobile, message, sender = null, templateId = null }) {
    const resolvedSender = (sender || this.senderId || "THQPNT").trim();
    const resolvedTemplateId = (templateId || this.dltTemplateId || "").trim();

    // Token Key API Mode
    if (this.isTokenKeyMode()) {
      const queryParams = new URLSearchParams();
      queryParams.set("authentic-key", this.authKey);
      queryParams.set("senderid", resolvedSender);
      queryParams.set("route", (this.route || "16").trim());
      queryParams.set("number", mobile);
      queryParams.set("message", message);
      if (resolvedTemplateId) {
        queryParams.set("templateid", resolvedTemplateId);
      }
      return `${this.baseUrl}?${queryParams.toString()}`;
    }

    // Legacy Username/Password Mode (fallback)
    const queryParams = new URLSearchParams({
      username: this.username,
      password: this.password,
      senderid: resolvedSender,
      sender: resolvedSender,
      route: this.route || "default",
      to: mobile,
      mobiles: mobile,
      message: message,
    });

    if (resolvedTemplateId) {
      queryParams.set("template_id", resolvedTemplateId);
      queryParams.set("templateid", resolvedTemplateId);
      queryParams.set("dlt_template_id", resolvedTemplateId);
    }

    return `${this.baseUrl}?${queryParams.toString()}`;
  }

  /**
   * Redact sensitive credentials (authentic-key / password) from URLs
   * @param {string} url
   * @returns {string} Sanitized URL safe for logging
   */
  sanitizeUrl(url) {
    if (!url || typeof url !== "string") return "";
    return url
      .replace(/(authentic-key=)[^&]+/gi, "$1[REDACTED]")
      .replace(/(password=)[^&]+/gi, "$1[REDACTED]");
  }

  /**
   * Strip sensitive tokens from error or response strings
   * @param {string} text
   * @returns {string} Sanitized text
   */
  sanitizeMessage(text) {
    if (!text || typeof text !== "string") return "";
    let safe = text;
    if (this.authKey) {
      safe = safe.split(this.authKey).join("[REDACTED]");
    }
    if (this.password) {
      safe = safe.split(this.password).join("[REDACTED]");
    }
    return safe;
  }

  /**
   * Send SMS via Webz Media Gateway
   * @param {Object} options
   * @param {string} options.to - 10-digit mobile number
   * @param {string} options.message - SMS message text
   * @param {string} [options.sender] - Optional Sender ID override
   * @param {string} [options.templateId] - Optional DLT Content Template ID
   * @returns {Promise<{success: boolean, messageId: string, provider: string, recipient: string}>}
   */
  async sendSms({ to, message, sender = null, templateId = null }) {
    const mobile = this.formatPhoneNumber(to);
    if (!mobile || mobile.length !== 10) {
      throw new Error(`Invalid recipient mobile number: "${to}". Must be a 10-digit Indian mobile.`);
    }

    if (!message || !message.trim()) {
      throw new Error("Message text cannot be empty");
    }

    // In unconfigured dev environments or unit test runs without live credentials, return mock success
    if (process.env.NODE_ENV === "test" || !this.isConfigured()) {
      if (process.env.NODE_ENV !== "test") {
        console.warn(
          `[Webzmedia SMS Mock] No active credentials configured (WEBZMEDIA_AUTH_KEY). Simulating SMS to ${mobile}.`
        );
      }
      return {
        success: true,
        messageId: `mock_wm_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        provider: this.isTokenKeyMode() ? "webzmedia_tokenkey" : "webzmedia",
        recipient: mobile,
      };
    }

    const requestUrl = this.buildRequestUrl({
      mobile,
      message,
      sender,
      templateId,
    });

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

      const response = await fetch(requestUrl, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "User-Agent": "QuickPoint-Backend/1.0",
        },
      });

      clearTimeout(timeoutId);
      const rawText = (await response.text()).trim();

      // Check common error responses from Webz Media panel
      const lower = rawText.toLowerCase();
      if (
        lower.includes("invalid key") ||
        lower.includes("invalid authentic-key") ||
        lower.includes("invalid token") ||
        lower.includes("authentication failed") ||
        lower.includes("provide valid username") ||
        lower.includes("please provide username") ||
        lower.includes("invalid login") ||
        lower.includes("insufficient balance") ||
        lower.includes("invalid sender") ||
        lower.includes("dlt template not match") ||
        lower.includes("invalid route") ||
        lower.includes("invalid number")
      ) {
        const safeError = this.sanitizeMessage(rawText);
        console.error(`[Webzmedia SMS Error] ${safeError} (recipient: ${mobile})`);
        throw new Error(`Webzmedia SMS gateway rejected request: ${safeError}`);
      }

      if (!response.ok) {
        const safeError = this.sanitizeMessage(rawText);
        throw new Error(`Webzmedia SMS gateway HTTP error ${response.status}: ${safeError}`);
      }

      const safeResponse = this.sanitizeMessage(rawText);
      console.log(`📱 [Webzmedia SMS Sent] Recipient: ${mobile} | Response: ${safeResponse}`);

      return {
        success: true,
        messageId: safeResponse || `wm_${Date.now()}`,
        provider: "webzmedia",
        recipient: mobile,
      };
    } catch (err) {
      if (err.name === "AbortError") {
        console.error(`[Webzmedia SMS Timeout] Request timed out for ${mobile}`);
        throw new Error("Webzmedia SMS gateway request timed out (10s)");
      }
      const safeErrorMessage = this.sanitizeMessage(err.message);
      console.error(`[Webzmedia SMS Delivery Failed] to ${mobile}:`, safeErrorMessage);
      throw new Error(safeErrorMessage);
    }
  }
}

module.exports = WebzmediaSmsProvider;
