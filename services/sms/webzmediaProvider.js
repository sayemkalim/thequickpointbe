/**
 * Webz Media SMS Gateway Provider
 * Integrates with http://sms.webzmedia.co.in/http-api.php
 */
class WebzmediaSmsProvider {
  constructor(config = {}) {
    this.baseUrl = (
      config.baseUrl ||
      process.env.WEBZMEDIA_URL ||
      "http://sms.webzmedia.co.in/http-api.php"
    ).trim();

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

    this.senderId = (
      config.senderId ||
      process.env.WEBZMEDIA_SENDER_ID ||
      process.env.SMS_SENDER_ID ||
      "QPOINT"
    ).trim();

    this.route = (
      config.route ||
      process.env.WEBZMEDIA_ROUTE ||
      "default"
    ).trim();

    this.dltTemplateId = (
      config.dltTemplateId ||
      process.env.WEBZMEDIA_DLT_TE_ID ||
      ""
    ).trim();
  }

  /**
   * Check if provider has minimal credentials configured
   */
  isConfigured() {
    return Boolean(this.username && this.password);
  }

  /**
   * Format phone number to clean 10-digit Indian mobile
   * Webz Media HTTP gateway accepts 10-digit or 91XXXXXXXXXX
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
   * Send SMS via Webzmedia HTTP API
   * @param {Object} options
   * @param {string} options.to - 10-digit mobile number
   * @param {string} options.message - SMS message text
   * @param {string} [options.sender] - Optional Sender ID override
   * @param {string} [options.templateId] - Optional DLT Content Template ID
   * @returns {Promise<{success: boolean, messageId: string, provider: string}>}
   */
  async sendSms({ to, message, sender = null, templateId = null }) {
    const mobile = this.formatPhoneNumber(to);
    if (!mobile || mobile.length !== 10) {
      throw new Error(`Invalid recipient mobile number: "${to}". Must be a 10-digit Indian mobile.`);
    }

    if (!message || !message.trim()) {
      throw new Error("Message text cannot be empty");
    }

    const resolvedSender = (sender || this.senderId || "QPOINT").trim();
    const resolvedTemplateId = (templateId || this.dltTemplateId || "").trim();

    // In test or unconfigured dev environments, return mock success
    if (process.env.NODE_ENV === "test" || !this.isConfigured()) {
      if (process.env.NODE_ENV !== "test") {
        console.warn(
          `[Webzmedia SMS Mock] Missing credentials (WEBZMEDIA_USERNAME/WEBZMEDIA_PASSWORD). Simulating SMS to ${mobile}: "${message}"`
        );
      }
      return {
        success: true,
        messageId: `mock_wm_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        provider: "webzmedia_mock",
        recipient: mobile,
      };
    }

    // Prepare query parameters according to Webzmedia HTTP API format
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

    const url = `${this.baseUrl}?${queryParams.toString()}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

      const response = await fetch(url, {
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
        lower.includes("provide valid username") ||
        lower.includes("please provide username") ||
        lower.includes("invalid login") ||
        lower.includes("authentication failed") ||
        lower.includes("insufficient balance") ||
        lower.includes("invalid sender") ||
        lower.includes("dlt template not match")
      ) {
        console.error(`[Webzmedia SMS Error] ${rawText} (recipient: ${mobile})`);
        throw new Error(`Webzmedia SMS gateway rejected request: ${rawText}`);
      }

      console.log(`📱 [Webzmedia SMS Sent] Recipient: ${mobile} | Response: ${rawText}`);

      return {
        success: true,
        messageId: rawText || `wm_${Date.now()}`,
        provider: "webzmedia",
        recipient: mobile,
      };
    } catch (err) {
      if (err.name === "AbortError") {
        console.error(`[Webzmedia SMS Timeout] Request timed out for ${mobile}`);
        throw new Error("Webzmedia SMS gateway request timed out (10s)");
      }
      console.error(`[Webzmedia SMS Delivery Failed] to ${mobile}:`, err.message);
      throw err;
    }
  }
}

module.exports = WebzmediaSmsProvider;
