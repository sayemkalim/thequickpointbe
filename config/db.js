const mongoose = require("mongoose");
const Admin = require("../models/adminModel");
const Franchise = require("../models/franchiseModel");

const seedInitialAdmins = async () => {
  try {
    const barbighaEmail = "thequickpointbarbigha@gmail.com";
    let admin = await Admin.findOne({ email: barbighaEmail });

    // Look for Barbigha franchise if exists to link
    let franchiseId = null;
    try {
      const barbighaStore = await Franchise.findOne({
        $or: [
          { name: { $regex: "barbigha", $options: "i" } },
          { city: { $regex: "barbigha", $options: "i" } },
          { code: { $regex: "barbigha", $options: "i" } },
        ],
      });
      if (barbighaStore) {
        franchiseId = barbighaStore._id;
      }
    } catch (e) {
      // ignore franchise lookup error
    }

    if (!admin) {
      admin = new Admin({
        name: "Super Admin",
        email: barbighaEmail,
        password: "thequickpoint",
        role: "super_admin",
        franchise: null,
      });
      await admin.save();
      console.log("✅ Seeded super_admin: " + barbighaEmail);
    } else {
      admin.name = "Super Admin";
      admin.password = "thequickpoint";
      admin.role = "super_admin";
      admin.franchise = null;
      await admin.save();
      console.log("✅ Updated super_admin password & role for: " + barbighaEmail);
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
