import WithdrawMethodSetting from "../models/WithdrawMethodSetting.model.js";
import {
  DEFAULT_ENABLED_WITHDRAW_METHODS,
  WITHDRAW_METHOD_DEFS,
  WITHDRAW_METHOD_CODES,
  normalizeEnabledMap,
  isConfigurableWithdrawMethod,
} from "../constants/withdrawMethods.js";

function toPublicPayload(brokerId, methodsMap) {
  const methods = normalizeEnabledMap(methodsMap);
  return {
    brokerId: brokerId ? String(brokerId) : null,
    methods,
    catalog: WITHDRAW_METHOD_DEFS.map((def) => ({
      ...def,
      enabled: Boolean(methods[def.code]),
    })),
    enabledMethods: WITHDRAW_METHOD_DEFS.filter((def) => methods[def.code]).map(
      (def) => ({
        code: def.code,
        label: def.label,
        description: def.description,
        fields: def.fields,
      }),
    ),
  };
}

export async function getWithdrawMethodSettingsService(brokerId) {
  if (!brokerId) {
    throw new Error("brokerId is required");
  }

  const doc = await WithdrawMethodSetting.findOne({ brokerId }).lean();
  if (!doc) {
    return toPublicPayload(brokerId, DEFAULT_ENABLED_WITHDRAW_METHODS);
  }

  return toPublicPayload(brokerId, doc.methods || {});
}

export async function upsertWithdrawMethodSettingsService({
  brokerId,
  methods,
  updatedBy = null,
}) {
  if (!brokerId) {
    throw new Error("brokerId is required");
  }

  if (!methods || typeof methods !== "object") {
    throw new Error("methods object is required");
  }

  const next = normalizeEnabledMap(methods);
  for (const code of WITHDRAW_METHOD_CODES) {
    if (methods[code] !== undefined && typeof methods[code] !== "boolean") {
      throw new Error(`${code} must be a boolean`);
    }
  }

  const doc = await WithdrawMethodSetting.findOneAndUpdate(
    { brokerId },
    {
      $set: {
        methods: next,
        updatedBy: updatedBy || null,
      },
      $setOnInsert: { brokerId },
    },
    { upsert: true, new: true },
  ).lean();

  return toPublicPayload(brokerId, doc.methods || next);
}

export async function assertWithdrawMethodEnabled(brokerId, method) {
  const code = String(method || "").toUpperCase();
  if (!isConfigurableWithdrawMethod(code)) {
    return {
      ok: false,
      message: "Invalid withdrawal method",
    };
  }

  const settings = await getWithdrawMethodSettingsService(brokerId);
  if (!settings.methods[code]) {
    return {
      ok: false,
      message: `${code} withdrawals are not enabled for this broker`,
    };
  }
  return { ok: true, message: "OK" };
}
