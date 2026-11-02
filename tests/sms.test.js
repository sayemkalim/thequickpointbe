const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

const WebzmediaSmsProvider = require("../services/sms/webzmediaProvider");
const SmsService = require("../services/sms/index");

describe("WebzMedia SMS Token Key API & OTP Integration", () => {
  let originalFetch;
  let originalEnv;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
  });

  // 1. Phone Number Sanitization
  test("1. Correctly formats and sanitizes Indian phone numbers to 10 digits", () => {
    const provider = new WebzmediaSmsProvider({
      authKey: "secret_token_12345",
    });

    assert.equal(provider.formatPhoneNumber("+919876543210"), "9876543210");
    assert.equal(provider.formatPhoneNumber("919876543210"), "9876543210");
    assert.equal(provider.formatPhoneNumber("09876543210"), "9876543210");
    assert.equal(provider.formatPhoneNumber("9876543210"), "9876543210");
    assert.equal(provider.formatPhoneNumber("+91 98765 43210"), "9876543210");
  });

  // 2. Token Key URL Construction & Query Parameters
  test("2. Constructs Token Key API URL with exact required parameters", () => {
    const provider = new WebzmediaSmsProvider({
      authKey: "test_token_abc_xyz_789",
      senderId: "THQPNT",
      route: "16",
      dltTemplateId: "1107176249859819412",
      baseUrl: "http://sms.webzmedia.co.in/http-tokenkeyapi.php",
    });

    const mobile = "9876543210";
    const otp = "582104";
    const message = `(${otp}) is your one-time password for account verification. Please enter the OTP to proceed. The Quick Point`;

    const requestUrl = provider.buildRequestUrl({
      mobile,
      message,
    });

    const parsedUrl = new URL(requestUrl);

    assert.equal(parsedUrl.origin + parsedUrl.pathname, "http://sms.webzmedia.co.in/http-tokenkeyapi.php");

    // Exact query parameter validation
    assert.equal(parsedUrl.searchParams.get("authentic-key"), "test_token_abc_xyz_789");
    assert.equal(parsedUrl.searchParams.get("senderid"), "THQPNT");
    assert.equal(parsedUrl.searchParams.get("route"), "16");
    assert.equal(parsedUrl.searchParams.get("number"), "9876543210");
    assert.equal(parsedUrl.searchParams.get("message"), message);
    assert.equal(parsedUrl.searchParams.get("templateid"), "1107176249859819412");

    // Must NOT contain legacy parameters in Token Key mode
    assert.equal(parsedUrl.searchParams.get("username"), null);
    assert.equal(parsedUrl.searchParams.get("password"), null);
    assert.equal(parsedUrl.searchParams.get("to"), null);
    assert.equal(parsedUrl.searchParams.get("mobiles"), null);
  });

  // 3. Exact DLT Template Text Verification
  test("3. sendLoginOtp formats message strictly matching approved DLT template", async () => {
    const otp = "934812";
    const expectedMessage = `(${otp}) is your one-time password for account verification. Please enter the OTP to proceed. The Quick Point`;

    // Intercept sendSms
    let capturedOptions = null;
    const originalSendSms = SmsService.sendSms;
    SmsService.sendSms = async (options) => {
      capturedOptions = options;
      return { success: true, messageId: "test_msg_id" };
    };

    try {
      await SmsService.sendLoginOtp({
        phone: "+919876543210",
        otp,
      });

      assert.ok(capturedOptions);
      assert.equal(capturedOptions.to, "+919876543210");
      assert.equal(capturedOptions.message, expectedMessage);
      assert.equal(capturedOptions.sender, "THQPNT");
      assert.equal(capturedOptions.templateId, "1107176249859819412");
    } finally {
      SmsService.sendSms = originalSendSms;
    }
  });

  // 4. Secret Redaction & Sanitization
  test("4. Sanitizes secret authentic-key in URLs and log messages", () => {
    const authKey = "SUPER_SECRET_TOKEN_KEY_999";
    const provider = new WebzmediaSmsProvider({
      authKey,
      senderId: "THQPNT",
      route: "16",
    });

    const rawUrl = provider.buildRequestUrl({
      mobile: "9876543210",
      message: "(123456) is your one-time password for account verification. Please enter the OTP to proceed. The Quick Point",
    });

    // Check sanitizeUrl
    const sanitizedUrl = provider.sanitizeUrl(rawUrl);
    assert.ok(!sanitizedUrl.includes(authKey), "Sanitized URL must not contain the raw authentic-key");
    assert.ok(sanitizedUrl.includes("authentic-key=[REDACTED]"));

    // Check sanitizeMessage
    const errorWithSecret = `Failed to connect with token ${authKey} on server`;
    const sanitizedError = provider.sanitizeMessage(errorWithSecret);
    assert.ok(!sanitizedError.includes(authKey), "Sanitized error must not contain the raw authentic-key");
    assert.ok(sanitizedError.includes("[REDACTED]"));
  });

  // 5. Successful API Response Handling via HTTP Mock
  test("5. Handles successful WebzMedia gateway HTTP response", async () => {
    const testSecret = "my_token_secret_123";
    const provider = new WebzmediaSmsProvider({
      authKey: testSecret,
      senderId: "THQPNT",
      route: "16",
      dltTemplateId: "1107176249859819412",
    });

    // Temporarily set NODE_ENV to production to test live flow
    process.env.NODE_ENV = "production";

    global.fetch = async (url, options) => {
      assert.equal(options.method, "GET");
      assert.equal(options.headers["User-Agent"], "QuickPoint-Backend/1.0");
      assert.ok(url.includes(`authentic-key=${testSecret}`));

      return {
        ok: true,
        status: 200,
        text: async () => "MSGID: 98127391823912",
      };
    };

    const result = await provider.sendSms({
      to: "9876543210",
      message: "(654321) is your one-time password for account verification. Please enter the OTP to proceed. The Quick Point",
    });

    assert.equal(result.success, true);
    assert.equal(result.messageId, "MSGID: 98127391823912");
    assert.equal(result.provider, "webzmedia");
    assert.equal(result.recipient, "9876543210");
  });

  // 6. API Error & Gateway Rejection Handling without Leaking Key
  test("6. Throws error on gateway failure and does not leak authentication key", async () => {
    const testSecret = "CRITICAL_PRIVATE_KEY_SECRET";
    const provider = new WebzmediaSmsProvider({
      authKey: testSecret,
      senderId: "THQPNT",
      route: "16",
    });

    process.env.NODE_ENV = "production";

    // Scenario A: Gateway returns rejection error message with secret echoed
    global.fetch = async () => {
      return {
        ok: true,
        status: 200,
        text: async () => `Invalid Key provided: ${testSecret}`,
      };
    };

    await assert.rejects(
      async () => {
        await provider.sendSms({
          to: "9876543210",
          message: "(111222) is your one-time password for account verification. Please enter the OTP to proceed. The Quick Point",
        });
      },
      (err) => {
        assert.ok(err instanceof Error);
        assert.ok(!err.message.includes(testSecret), "Error message must never leak the secret key");
        assert.ok(err.message.includes("[REDACTED]"));
        return true;
      }
    );

    // Scenario B: Gateway returns HTTP 500 error
    global.fetch = async () => {
      return {
        ok: false,
        status: 500,
        text: async () => `Internal Server Error for token ${testSecret}`,
      };
    };

    await assert.rejects(
      async () => {
        await provider.sendSms({
          to: "9876543210",
          message: "(111222) is your one-time password for account verification. Please enter the OTP to proceed. The Quick Point",
        });
      },
      (err) => {
        assert.ok(!err.message.includes(testSecret), "HTTP 500 message must never leak the secret key");
        assert.ok(err.message.includes("[REDACTED]"));
        return true;
      }
    );
  });

  // 7. Backward Compatibility Fallback
  test("7. Falls back to legacy HTTP API format when only username & password are provided", () => {
    const provider = new WebzmediaSmsProvider({
      username: "legacy_user",
      password: "legacy_password",
      senderId: "THQPNT",
      route: "default",
      dltTemplateId: "1107176249859819412",
      baseUrl: "http://sms.webzmedia.co.in/http-api.php",
    });

    assert.equal(provider.isTokenKeyMode(), false);
    assert.equal(provider.isConfigured(), true);

    const requestUrl = provider.buildRequestUrl({
      mobile: "9876543210",
      message: "Test legacy message",
    });

    const parsed = new URL(requestUrl);
    assert.equal(parsed.searchParams.get("username"), "legacy_user");
    assert.equal(parsed.searchParams.get("password"), "legacy_password");
    assert.equal(parsed.searchParams.get("to"), "9876543210");
    assert.equal(parsed.searchParams.get("authentic-key"), null);
  });

  // 8. Unconfigured Dev/Test Environment Safe Fallback
  test("8. Safely simulates mock delivery when unconfigured without crashing", async () => {
    const provider = new WebzmediaSmsProvider({
      authKey: "",
      username: "",
      password: "",
    });

    assert.equal(provider.isConfigured(), false);

    const result = await provider.sendSms({
      to: "9876543210",
      message: "(333444) is your one-time password for account verification. Please enter the OTP to proceed. The Quick Point",
    });

    assert.equal(result.success, true);
    assert.ok(result.messageId.startsWith("mock_wm_"));
  });
});

