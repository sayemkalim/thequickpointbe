const brevo = require("@getbrevo/brevo");
const WebzmediaSmsProvider = require("./webzmediaProvider");

/**
 * Pluggable SMS Service
 * Supports Webzmedia (http://sms.webzmedia.co.in/http-api.php), Brevo SMS, and Mock/Console provider.
 */
class SmsService {
  constructor() {
    this.provider = (process.env.SMS_PROVIDER || "webzmedia").toLowerCase();
    this.brevoApiKey = process.env.BREVO_API_KEY;
    this.senderId = process.env.WEBZMEDIA_SENDER_ID || process.env.SMS_SENDER_ID || "QPOINT";
    this.webzmedia = new WebzmediaSmsProvider();

    if (this.brevoApiKey && this.provider === "brevo") {
      try {
        const defaultClient = brevo.ApiClient.instance;
        const apiKey = defaultClient.authentications["api-key"];
        apiKey.apiKey = this.brevoApiKey;
        this.smsApi = new brevo.TransactionalSMSApi();
      } catch (err) {
        console.warn("Brevo SMS client initialization warning:", err.message);
      }
    }
  }

  /**
   * Get active provider name
   */
  getProvider() {
    if (process.env.SMS_PROVIDER) {
      return process.env.SMS_PROVIDER.toLowerCase();
    }
    if (process.env.WEBZMEDIA_USERNAME || process.env.SMS_USERNAME) {
      return "webzmedia";
    }
    if (this.brevoApiKey) {
      return "brevo";
    }
    return "mock";
  }

  /**
   * Send SMS to a phone number
   * @param {Object} options
   * @param {string} options.to - Recipient phone number (e.g., +919876543210 or 9876543210)
   * @param {string} options.message - SMS message text
   * @param {string} [options.sender] - Optional sender ID override
   * @param {string} [options.templateId] - Optional DLT Template ID
   * @returns {Promise<{success: boolean, messageId?: string, provider: string}>}
   */
  async sendSms({ to, message, sender = null, templateId = null }) {
    if (!to || !message) {
      throw new Error("Recipient phone number and message are required");
    }

    const providerToUse = this.getProvider();

    // Development & Test Mode or Mock provider
    if (providerToUse === "mock" || process.env.NODE_ENV === "test") {
      if (process.env.NODE_ENV !== "test") {
        console.log(`📱 [SMS MOCK] To: ${to} | Msg: ${message}`);
      }
      return {
        success: true,
        messageId: `mock_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        provider: "mock",
        recipient: to,
      };
    }

    // 1. Webzmedia SMS Gateway (http://sms.webzmedia.co.in)
    if (providerToUse === "webzmedia") {
      try {
        return await this.webzmedia.sendSms({
          to,
          message,
          sender: sender || this.senderId,
          templateId,
        });
      } catch (err) {
        console.error("Webzmedia SMS delivery failed:", err.message);
        if (process.env.NODE_ENV === "development") {
          console.warn(`[SMS Fallback] Sent to ${to}: ${message}`);
          return { success: true, provider: "mock_fallback", recipient: to };
        }
        throw err;
      }
    }

    // 2. Brevo Transactional SMS
    if (providerToUse === "brevo" && this.smsApi) {
      try {
        let recipient = to.trim();
        if (!recipient.startsWith("+")) {
          recipient = recipient.length === 10 ? `+91${recipient}` : `+${recipient}`;
        }

        const sendTransacSms = new brevo.SendTransacSms();
        sendTransacSms.sender = (sender || this.senderId || "QPOINT").substring(0, 11);
        sendTransacSms.recipient = recipient;
        sendTransacSms.content = message;
        sendTransacSms.type = "transactional";

        const response = await this.smsApi.sendTransacSms(sendTransacSms);
        return {
          success: true,
          messageId: response?.body?.messageId || `brevo_${Date.now()}`,
          provider: "brevo",
          recipient,
        };
      } catch (error) {
        console.error("Brevo SMS delivery failed:", error.response?.body || error.message);
        if (process.env.NODE_ENV === "development") {
          console.warn(`[SMS Fallback] Sent to ${to}: ${message}`);
          return { success: true, provider: "mock_fallback", recipient: to };
        }
        throw new Error(`SMS delivery failed: ${error.message}`);
      }
    }

    // Default fallback
    console.log(`📱 [SMS SENT] To: ${to} | Msg: ${message}`);
    return {
      success: true,
      messageId: `sms_${Date.now()}`,
      provider: providerToUse,
      recipient: to,
    };
  }

  /**
   * Helper to send Customer Login / Registration Mobile OTP
   */
  async sendLoginOtp({ phone, otp, templateId = null }) {
    const message = `Your verification OTP for QuickPoint Dairy is: ${otp}. Valid for 10 minutes. Do not share this OTP with anyone.`;
    return this.sendSms({ to: phone, message, templateId });
  }

  /**
   * Helper to send Pickup OTP to customer
   */
  async sendPickupOtp({ phone, orderNumber, otp, outletName, templateId = null }) {
    const message = `Your Dairy Pickup OTP for Order #${orderNumber} at ${outletName} is: ${otp}. Please share this with the outlet staff during pickup.`;
    return this.sendSms({ to: phone, message, templateId });
  }

  /**
   * Helper to send Pickup Confirmation SMS to customer
   */
  async sendPickupConfirmation({ phone, orderNumber, outletName, templateId = null }) {
    const message = `Order #${orderNumber} has been successfully picked up from ${outletName}. Thank you for ordering fresh dairy products with us!`;
    return this.sendSms({ to: phone, message, templateId });
  }
}

module.exports = new SmsService();
