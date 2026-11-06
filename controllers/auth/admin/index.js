const { asyncHandler } = require("../../../common/asyncHandler");
const Admin = require("../../../models/adminModel");
const ApiResponse = require("../../../utils/ApiResponse");
const {
  generateAccessToken,
  // generateRefreshToken,
} = require("../../../utils/auth");

const getAllAdmins = asyncHandler(async (req, res) => {
  const { search = "", page = 1, per_page = 50, role } = req.query;

  const adminUser = req.admin;

  if (!adminUser) {
    return res.status(401).json(new ApiResponse(401, null, "Not authorized", false));
  }

  const query = {};

  if (role && role !== "all") {
    query.role = role;
  } else {
    // Return all staff & admin roles
    query.role = { $in: ["admin", "franchise_owner", "sub_admin", "super_admin"] };
  }

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }

  const skip = (page - 1) * per_page;

  const admins = await Admin.find(query)
    .populate("franchise", "name code address city district location")
    .select("-password")
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(parseInt(per_page, 10));

  const totalAdmins = await Admin.countDocuments(query);

  res.json(
    new ApiResponse(
      200,
      { data: admins, total: totalAdmins },
      "Admins fetched successfully",
      true
    )
  );
});

const registerAdmin = asyncHandler(async (req, res) => {
  const { name, email, password, role, franchise, franchiseId } = req.body;
  const cleanEmail = email?.toLowerCase()?.trim();
  const adminExists = await Admin.findOne({ email: cleanEmail });

  if (adminExists) {
    return res
      .status(400)
      .json(new ApiResponse(400, null, "Admin already exists", false));
  }

  const admin = await Admin.create({
    name: name?.trim(),
    email: cleanEmail,
    password,
    role: role || "admin",
    franchise: franchise || franchiseId || null,
  });

  const accessToken = generateAccessToken(admin._id);

  const populatedAdmin = await Admin.findById(admin._id)
    .populate("franchise", "name code address city district")
    .select("-password");

  const data = {
    id: admin.id,
    name: admin.name,
    email: admin.email,
    role: admin.role,
    franchise: populatedAdmin?.franchise || admin.franchise,
    token: accessToken,
  };

  res.json(new ApiResponse(201, data, "New admin created successfully", true));
});

const loginAdmin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const admin = await Admin.findOne({ email: email?.toLowerCase()?.trim() }).populate(
    "franchise",
    "name code address city district"
  );
  if (!admin || !(await admin.matchPassword(password))) {
    return res
      .status(401)
      .json(new ApiResponse(401, null, "Invalid credentials", false));
  }

  const accessToken = generateAccessToken(admin._id);
  //   const refreshToken = generateRefreshToken(admin._id);
  //   sendRefreshToken(res, refreshToken);

  const data = {
    id: admin.id,
    name: admin.name,
    email: admin.email,
    role: admin.role,
    franchise: admin.franchise || null,
    token: accessToken,
  };

  res.json(new ApiResponse(200, data, "Admin login successful", true));
});

const updateAdmin = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { name, email, role, franchise, franchiseId, password } = req.body;

  const admin = await Admin.findById(id);
  if (!admin) {
    return res
      .status(404)
      .json(new ApiResponse(404, null, "Admin not found", false));
  }

  if (name) admin.name = name.trim();
  if (email) admin.email = email.toLowerCase().trim();
  if (role) admin.role = role;
  if (franchise !== undefined || franchiseId !== undefined) {
    admin.franchise = franchise || franchiseId || null;
  }
  if (password && password.trim()) admin.password = password;

  await admin.save();

  const updatedAdmin = await Admin.findById(id)
    .populate("franchise", "name code address city district")
    .select("-password");

  res.json(
    new ApiResponse(200, updatedAdmin, "Admin updated successfully", true)
  );
});

const deleteAdmin = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const admin = await Admin.findById(id);
  if (!admin) {
    return res
      .status(404)
      .json(new ApiResponse(404, null, "Admin not found", false));
  }

  if (admin.role === "super_admin") {
    return res
      .status(403)
      .json(new ApiResponse(403, null, "Cannot delete super_admin account", false));
  }

  await admin.deleteOne();

  res.json(new ApiResponse(200, null, "Admin deleted successfully", true));
});

const getAllSubAdmins = asyncHandler(async (req, res) => {
  const adminId = req.admin._id;

  const subAdmins = await Admin.find({
    role: "sub_admin",
    created_by: adminId,
  })
    .populate("franchise", "name code address city district")
    .select("-password");

  res.json(
    new ApiResponse(200, subAdmins, "Sub Admins fetched successfully", true)
  );
});

const registerSubAdmin = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;

  const reqAdmin = req.admin;
  const adminId = reqAdmin.id;

  if (reqAdmin.role !== "admin" && reqAdmin.role !== "super_admin") {
    return res
      .status(400)
      .json(
        new ApiResponse(400, null, "Only central admins can create sub admin", false)
      );
  }

  const cleanEmail = email?.toLowerCase()?.trim();
  const admin = await Admin.findOne({ email: cleanEmail });

  if (admin) {
    return res
      .status(400)
      .json(new ApiResponse(400, null, "Sub Admin already exists", false));
  }

  const subAdmin = await Admin.create({
    name: name?.trim(),
    email: cleanEmail,
    password,
    role: "sub_admin",
    created_by: adminId,
  });

  const accessToken = generateAccessToken(subAdmin._id);

  const data = {
    id: subAdmin.id,
    name: subAdmin.name,
    email: subAdmin.email,
    token: accessToken,
    role: subAdmin.role,
    created_by: subAdmin.created_by,
  };

  res.json(
    new ApiResponse(201, data, "New sub admin created successfully", true)
  );
});

const getSingleAdmin = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const admin = await Admin.findById(id)
    .populate("franchise", "name code address city district location")
    .select("-password");
  if (!admin) {
    return res
      .status(404)
      .json(new ApiResponse(404, null, "Admin not found", false));
  }
  res.json(new ApiResponse(200, admin, "Admin fetched successfully", true));
});


const crypto = require("crypto");
const { sendForgotPasswordEmail } = require("../../../utils/email/directEmailService");

const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res
      .status(400)
      .json(new ApiResponse(400, null, "Email is required", false));
  }

  const admin = await Admin.findOne({ email: email.toLowerCase().trim() });
  if (!admin) {
    return res
      .status(404)
      .json(new ApiResponse(404, null, "Admin account with this email was not found", false));
  }

  // Generate a temporary 6-digit random password
  const tempPassword = crypto.randomInt(100000, 1000000).toString();

  admin.password = tempPassword;
  await admin.save();

  // Send email asynchronously
  setImmediate(async () => {
    try {
      await sendForgotPasswordEmail({
        user: { name: admin.name || "Admin", email: admin.email },
        newPassword: tempPassword,
      });
      console.log("✅ Admin password reset email sent to:", admin.email);
    } catch (err) {
      console.error("❌ Failed to send admin password reset email:", err.message);
    }
  });

  res.json(
    new ApiResponse(
      200,
      null,
      "Temporary password has been sent to your email. Please check your inbox.",
      true
    )
  );
});

module.exports = {
  forgotPassword,
  getAllAdmins,
  registerAdmin,
  loginAdmin,
  updateAdmin,
  deleteAdmin,
  getAllSubAdmins,
  registerSubAdmin,
  getSingleAdmin,
};
