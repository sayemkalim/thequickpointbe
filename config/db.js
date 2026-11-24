const mongoose = require("mongoose");
const Admin = require("../models/adminModel");
const Franchise = require("../models/franchiseModel");

const seedInitialAdmins = async () => {
  try {
    const superAdminEmails = [
      "thequickpoint@gmail.com",
      "thequickpointbarbigha@gmail.com",
    ];

    for (const email of superAdminEmails) {
      let admin = await Admin.findOne({ email });
      if (!admin) {
        admin = new Admin({
          name: "Super Admin",
          email,
          password: "thequickpoint",
          role: "super_admin",
          franchise: null,
        });
        await admin.save();
        console.log("✅ Seeded super_admin: " + email);
      } else {
        admin.name = "Super Admin";
        admin.password = "thequickpoint";
        admin.role = "super_admin";
        admin.franchise = null;
        await admin.save();
        console.log("✅ Verified super_admin: " + email);
      }
    }
  } catch (err) {
    console.error("Initial admin seed notice:", err.message);
  }
};

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      maxPoolSize: 50,
      minPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log("MongoDB Connected: " + conn.connection.host);
    seedInitialAdmins();
  } catch (error) {
    console.error("Error: " + error.message);
    process.exit(1);
  }
};

module.exports = connectDB;
