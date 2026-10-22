import mongoose from "mongoose";

const schema = new mongoose.Schema({
  _id: String,
  value: { type: Number, required: true },
}, { versionKey: false });

export default mongoose.model("OrderTicketCounter", schema);
