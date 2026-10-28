import mongoose from "mongoose";
import { WITHDRAW_METHOD_CODES } from "../constants/withdrawMethods.js";

const methodsShape = {};
for (const code of WITHDRAW_METHOD_CODES) {
  methodsShape[code] = { type: Boolean, default: false };
}

const withdrawMethodSettingSchema = new mongoose.Schema(
  {
    brokerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Broker",
      required: true,
      unique: true,
      index: true,
    },
    methods: methodsShape,
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true, versionKey: false },
);

export default mongoose.model(
  "WithdrawMethodSetting",
  withdrawMethodSettingSchema,
);
