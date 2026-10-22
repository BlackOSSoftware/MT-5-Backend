import mongoose from "mongoose";
import { PLATFORMS } from "./appUpdate.constants.js";

/** Har platform ki ek row: latest build + kahan se download + force ya nahi. */
const AppReleaseSchema = new mongoose.Schema(
  {
    platform: {
      type: String,
      enum: PLATFORMS,
      required: true,
      unique: true,
      index: true,
    },
    latestVersionName: { type: String, required: true, trim: true },
    /** pubspec `version: x.y.z+CODE` ka CODE (Android versionCode). */
    latestVersionCode: { type: Number, required: true, min: 1 },
    /** Poora URL ya `/downloads/app.apk` jaisa path (app khud host jodta hai). */
    apkUrl: { type: String, required: true, trim: true },
    force: { type: Boolean, default: false },
    releaseNotes: { type: String, default: "" },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true, versionKey: false },
);

export default mongoose.model("AppRelease", AppReleaseSchema);
