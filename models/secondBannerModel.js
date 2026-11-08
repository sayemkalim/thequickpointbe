const mongoose = require("mongoose");

const SecondBannerSchema = new mongoose.Schema(
  {
    banner_url: {
      type: String,
      required: true,
    },
    title: {
      type: String,
      trim: true,
      default: "",
    },
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Product",
      default: null,
    },
    link: {
      type: String,
      trim: true,
      default: "",
    },
    order: {
      type: Number,
      default: 0,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtual for banner_image so frontend / mobile app can use either banner_url or banner_image
SecondBannerSchema.virtual("banner_image").get(function () {
  return this.banner_url;
});

SecondBannerSchema.index({ is_active: 1, order: 1 });

const SecondBanner = mongoose.model("SecondBanner", SecondBannerSchema);
module.exports = SecondBanner;
