const { asyncHandler } = require("../../../common/asyncHandler");
const User = require("../../../models/userModel");
const ApiResponse = require("../../../utils/ApiResponse");
const { generateAccessToken } = require("../../../utils/auth");
const { sendWelcomeEmail } = require("../../../utils/email/directEmailService");
const { OAuth2Client } = require("google-auth-library");

/**
 * Super Admin: Get all users with search and pagination
 */
const getAllUsers = asyncHandler(async (req, res) => {
  const superAdminId = req.admin?._id;

  if (!superAdminId) {
    return res.json(new ApiResponse(404, null, "Not authorized"));
  }

  const { search, page = 1, per_page = 50 } = req.query;

  const filters = {
    ...(search && {
      $or: [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ],
    }),
  };

  const skip = (page - 1) * per_page;

  const users = await User.find(filters)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(per_page);

  res.json(new ApiResponse(200, users, "Users fetched successfully", true));
});

/**
 * Get user profile by ID
 */
const getUserById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const user = await User.findById(id);
  if (!user) {
    return res
      .status(404)
      .json(new ApiResponse(404, null, "User not found", false));
  }

  res.json(new ApiResponse(200, user, "User fetched successfully", true));
});

/**
 * Update user profile (name, email, phone)
 */
const updateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, email, phone } = req.body;

  const user = await User.findById(id);
  if (!user) {
    return res
      .status(404)
      .json(new ApiResponse(404, null, "User not found", false));
  }

  if (email && email !== user.email) {
    const existingEmail = await User.findOne({ email, _id: { $ne: id } });
    if (existingEmail) {
      return res
        .status(400)
        .json(new ApiResponse(400, null, "Email is already in use by another account", false));
    }
    user.email = email;
  }

  if (phone && phone !== user.phone) {
    const cleanPhone = String(phone).replace(/\D/g, "").slice(-10);
    const existingPhone = await User.findOne({ phone: cleanPhone, _id: { $ne: id } });
    if (existingPhone) {
      return res
        .status(400)
        .json(new ApiResponse(400, null, "Phone number is already in use by another account", false));
    }
    user.phone = cleanPhone;
  }

  if (name) user.name = name.trim();

  await user.save();

  res.json(new ApiResponse(200, user, "User updated successfully", true));
});

/**
 * Delete user account
 */
const deleteUser = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const user = await User.findById(id);
  if (!user) {
    return res
      .status(404)
      .json(new ApiResponse(404, null, "User not found", false));
  }

  await user.deleteOne();

  res.json(new ApiResponse(200, null, "User deleted successfully", true));
});

/**
 * Google OAuth Login
 * Verifies Google ID token and creates/logs in customer
 */
const googleLogin = asyncHandler(async (req, res) => {
  const { idToken } = req.body;

  if (!idToken) {
    return res
      .status(400)
      .json(new ApiResponse(400, null, "Google ID token is required", false));
  }

  try {
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    if (!email) {
      return res
        .status(400)
        .json(new ApiResponse(400, null, "Email not provided by Google", false));
    }

    let user = await User.findOne({ googleId });

    if (!user) {
      user = await User.findOne({ email });

      if (user) {
        user.googleId = googleId;
        user.authProvider = user.authProvider === "local" ? "local" : "google";
        if (picture && !user.profilePicture) {
          user.profilePicture = picture;
        }
        await user.save();
      } else {
        user = await User.create({
          name,
          email,
          googleId,
          authProvider: "google",
          profilePicture: picture,
        });

        setImmediate(async () => {
          try {
            await sendWelcomeEmail({
              user: user.toObject(),
            });
          } catch (error) {
            console.error("❌ Failed to send welcome email:", error.message);
          }
        });
      }
    } else {
      if (picture && user.profilePicture !== picture) {
        user.profilePicture = picture;
        await user.save();
      }
    }

    const accessToken = generateAccessToken(user._id);

    const data = {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      profilePicture: user.profilePicture,
      authProvider: user.authProvider,
      token: accessToken,
    };

    res.json(new ApiResponse(200, data, "Google login successful", true));
  } catch (error) {
    console.error("Google login error:", error.message);
    if (error.message.includes("Token used too late") || error.message.includes("Invalid token")) {
      return res
        .status(401)
        .json(new ApiResponse(401, null, "Invalid or expired Google token", false));
    }
    return res
      .status(500)
      .json(new ApiResponse(500, null, error.message || "Google authentication failed", false));
  }
});

/**
 * Mobile OTP Step 1: Send 6-digit OTP via SMS to customer's mobile number
 */
const sendMobileOtp = asyncHandler(async (req, res) => {
  const { phoneNumber } = req.body;

  if (!phoneNumber) {
    return res
      .status(400)
      .json(new ApiResponse(400, null, "Phone number is required", false));
  }

  const cleanPhone = String(phoneNumber).replace(/\D/g, "");
  if (cleanPhone.length < 10) {
    return res
      .status(400)
      .json(new ApiResponse(400, null, "Valid 10-digit mobile number is required", false));
  }

  const phone = cleanPhone.slice(-10);

  // Generate 6-digit OTP (secure random or fixed for automated tests)
  const otp = process.env.NODE_ENV === "test" && req.headers["x-test-fixed-otp"]
    ? "123456"
    : Math.floor(100000 + Math.random() * 900000).toString();

  const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  let user = await User.findOne({ phone });
  if (!user) {
    user = new User({ phone });
  }

  user.mobileOtp = otp;
  user.mobileOtpExpires = otpExpires;
  user.mobileOtpAttempts = 0;
  await user.save();

  // Send SMS via WebzMedia Token Key API
  const SmsService = require("../../../services/sms/index");
  try {
    await SmsService.sendLoginOtp({
      phone,
      otp,
    });
  } catch (smsErr) {
    console.error("Failed to deliver OTP SMS:", smsErr.message);
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      { phone, expiresInMinutes: 10 },
      "OTP sent successfully to your mobile number",
      true
    )
  );
});

/**
 * Mobile OTP Step 2: Verify 6-digit OTP and login/register customer
 */
const verifyMobileOtp = asyncHandler(async (req, res) => {
  const { phoneNumber, otp, name } = req.body;

  if (!phoneNumber || !otp) {
    return res
      .status(400)
      .json(new ApiResponse(400, null, "Phone number and OTP are required", false));
  }

  const cleanPhone = String(phoneNumber).replace(/\D/g, "");
  const phone = cleanPhone.slice(-10);

  const user = await User.findOne({ phone });
  if (!user || !user.mobileOtp) {
    return res
      .status(400)
      .json(new ApiResponse(400, null, "No OTP request found for this phone number. Please request a new OTP.", false));
  }

  if (new Date() > new Date(user.mobileOtpExpires)) {
    return res
      .status(400)
      .json(new ApiResponse(400, null, "OTP has expired. Please request a new OTP.", false));
  }

  // Increment attempts counter
  user.mobileOtpAttempts = (user.mobileOtpAttempts || 0) + 1;

  if (user.mobileOtp !== String(otp).trim()) {
    await user.save();
    return res
      .status(400)
      .json(new ApiResponse(400, null, "Invalid OTP. Please check and try again.", false));
  }

  // OTP verified successfully -> clear OTP fields
  user.mobileOtp = null;
  user.mobileOtpExpires = null;
  user.mobileOtpAttempts = 0;

  if (name && !user.name) {
    user.name = name.trim();
  }

  await user.save();

  const accessToken = generateAccessToken(user._id);

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        user: {
          id: user._id,
          name: user.name,
          phone: user.phone,
          email: user.email,
        },
        accessToken,
      },
      "Customer authenticated successfully",
      true
    )
  );
});

module.exports = {
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  googleLogin,
  sendMobileOtp,
  verifyMobileOtp,
};
