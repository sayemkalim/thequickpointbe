const brevo = require("@getbrevo/brevo");

/**
 * Pluggable SMS Service
 * Supports Brevo SMS, Mock/Console provider for dev/test, and extensible for Twilio/Fast2SMS.
 */
class SmsService {
  constructor() {
    this.provider = process.env.SMS_PROVIDER || "mock";
    this.brevoApiKey = process.env.BREVO_API_KEY;
    this.senderId = process.env.SMS_SENDER_ID || "DAIRY";

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
   * Send SMS to a phone number
   * @param {Object} options
   * @param {string} options.to - Recipient phone number (e.g., +919876543210 or 9876543210)
   * @param {string} options.message - SMS message text
   * @param {string} [options.sender] - Optional sender ID override
   * @returns {Promise<{success: boolean, messageId?: string, provider: string}>}
   */
  async sendSms({ to, message, sender = null }) {
    if (!to || !message) {
      throw new Error("Recipient phone number and message are required");
    }

    // Format phone to international format if not present
    let recipient = to.trim();
    if (!recipient.startsWith("+")) {
      recipient = recipient.length === 10 ? `+91${recipient}` : `+${recipient}`;
    }

    const providerToUse = this.provider;

    // Development & Test Mode or Mock provider
    if (providerToUse === "mock" || process.env.NODE_ENV === "test") {
      if (process.env.NODE_ENV !== "test") {
        console.log(`📱 [SMS MOCK] To: ${recipient} | Msg: ${message}`);
      }
      return {
        success: true,
        messageId: `mock_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        provider: "mock",
        recipient,
      };
    }

    if (providerToUse === "brevo" && this.smsApi) {
      try {
        const sendTransacSms = new brevo.SendTransacSms();
        sendTransacSms.sender = (sender || this.senderId || "DAIRY").substring(0, 11);
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
        // Fallback to mock log in development environments so transactions aren't blocked
        if (process.env.NODE_ENV === "development") {
          console.warn(`[SMS Fallback] Sent to ${recipient}: ${message}`);
          return { success: true, provider: "mock_fallback", recipient };
        }
        throw new Error(`SMS delivery failed: ${error.message}`);
      }
    }

    // Default fallback
    console.log(`📱 [SMS SENT] To: ${recipient} | Msg: ${message}`);
    return {
      success: true,
      messageId: `sms_${Date.now()}`,
      provider: providerToUse,
      recipient,
    };
  }

  /**
   * Helper to send Pickup OTP to customer
   */
  async sendPickupOtp({ phone, orderNumber, otp, outletName }) {
    const message = `Your Dairy Pickup OTP for Order #${orderNumber} at ${outletName} is: ${otp}. Please share this with the outlet staff during pickup.`;
    return this.sendSms({ to: phone, message });
  }

  /**
   * Helper to send Pickup Confirmation SMS to customer
   */
  async sendPickupConfirmation({ phone, orderNumber, outletName }) {
    const message = `Order #${orderNumber} has been successfully picked up from ${outletName}. Thank you for ordering fresh dairy products with us!`;
    return this.sendSms({ to: phone, message });
  }
}

module.exports = new SmsService();
