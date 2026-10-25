/**
 * Migrate BlackOS testing DB → live target under Broker BLACKOS.
 * Existing target rows → Broker DEFAULT (tag only).
 *
 * Usage:
 *   node scripts/migrateBlackosBroker.mjs
 *   DRY_RUN=1 node scripts/migrateBlackosBroker.mjs
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const SOURCE_URI =
  process.env.SOURCE_MONGO_URI ||
  "mongodb+srv://blackossoftwaresolution_db_user:BfGruzI44MmyCIpW@trade-backend-tetsing.cqwh7kq.mongodb.net/?appName=trade-backend-tetsing";
const TARGET_URI = process.env.MONGO_URI;
const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

const SUPERADMIN_EMAIL =
  (process.env.SUPERADMIN_EMAIL || "blackossoftwaresolution@gmail.com")
    .trim()
    .toLowerCase();

const ALL_PERMS = [
  "users.read",
  "users.create",
  "users.update",
  "kyc.review",
  "finance.deposit.approve",
  "finance.deposit.reject",
  "finance.withdrawal.approve",
  "finance.withdrawal.reject",
  "finance.payment_methods.manage",
  "plans.manage",
  "trading.positions.read",
  "trading.intervene",
  "settings.bonus",
  "settings.referral",
  "admins.manage",
  "reports.export",
];

const report = {
  taggedDefault: {},
  inserted: {},
  reused: {},
  skipped: {},
  errors: [],
};

function bump(bucket, key, n = 1) {
  bucket[key] = (bucket[key] || 0) + n;
}

async function ensureBroker(db, { code, displayName }) {
  const col = db.collection("brokers");
  let doc = await col.findOne({ code });
  if (!doc) {
    if (DRY_RUN) {
      console.log(`[DRY] would create broker ${code}`);
      return { _id: new mongoose.Types.ObjectId(), code, displayName, _dry: true };
    }
    const now = new Date();
    const r = await col.insertOne({
      code,
      displayName,
      legalName: displayName,
      status: "ACTIVE",
      baseCurrency: "USD",
      timezone: "Asia/Kolkata",
      createdAt: now,
      updatedAt: now,
    });
    doc = await col.findOne({ _id: r.insertedId });
  }
  return doc;
}

async function tagExistingWithBroker(db, brokerId, collections) {
  for (const name of collections) {
    try {
      const col = db.collection(name);
      const filter = {
        $or: [{ brokerId: null }, { brokerId: { $exists: false } }],
      };
      const count = await col.countDocuments(filter);
      if (!count) {
        bump(report.taggedDefault, name, 0);
        continue;
      }
      if (DRY_RUN) {
        bump(report.taggedDefault, name, count);
        continue;
      }
      const r = await col.updateMany(filter, { $set: { brokerId } });
      bump(report.taggedDefault, name, r.modifiedCount);
    } catch (e) {
      report.errors.push(`tag ${name}: ${e.message}`);
    }
  }
}

async function upsertMembership(db, { brokerId, userId, role }) {
  const col = db.collection("brokermemberships");
  const existing = await col.findOne({ brokerId, userId });
  if (existing) {
    if (!DRY_RUN) {
      await col.updateOne(
        { _id: existing._id },
        {
          $set: {
            role,
            permissions: ALL_PERMS,
            status: "ACTIVE",
            acceptedAt: new Date(),
            updatedAt: new Date(),
          },
        },
      );
    }
    return existing._id;
  }
  if (DRY_RUN) return new mongoose.Types.ObjectId();
  const now = new Date();
  const r = await col.insertOne({
    brokerId,
    userId,
    role,
    permissions: ALL_PERMS,
    status: "ACTIVE",
    invitedBy: null,
    acceptedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return r.insertedId;
}

function remapId(map, oldId) {
  if (!oldId) return null;
  const k = String(oldId);
  return map.get(k) || null;
}

async function copyUsers(src, tgt, brokerId, userMap) {
  const users = await src.collection("users").find({}).toArray();
  for (const u of users) {
    const email = String(u.email || "").toLowerCase();
    const existing = email
      ? await tgt.collection("users").findOne({ email })
      : null;

    if (existing) {
      userMap.set(String(u._id), existing._id);
      bump(report.reused, "users");
      if (!DRY_RUN) {
        const $set = { brokerId };
        if (email === SUPERADMIN_EMAIL) {
          $set.platformRole = "SUPER_ADMIN";
          $set.userType = "ADMIN";
          $set.isMailVerified = true;
        } else if (u.userType === "ADMIN") {
          $set.userType = "ADMIN";
        }
        await tgt.collection("users").updateOne({ _id: existing._id }, { $set });
      }
      continue;
    }

    const newId = u._id; // keep same ObjectId when free
    const clash = await tgt.collection("users").findOne({ _id: newId });
    const finalId = clash ? new mongoose.Types.ObjectId() : newId;
    userMap.set(String(u._id), finalId);

    const doc = {
      ...u,
      _id: finalId,
      email,
      brokerId,
      platformRole: email === SUPERADMIN_EMAIL ? "SUPER_ADMIN" : u.platformRole || null,
      userType: email === SUPERADMIN_EMAIL ? "ADMIN" : u.userType,
    };
    // phone unique — clear if clash
    if (doc.phone) {
      const phoneClash = await tgt.collection("users").findOne({ phone: doc.phone });
      if (phoneClash) delete doc.phone;
    }

    if (!DRY_RUN) {
      try {
        await tgt.collection("users").insertOne(doc);
        bump(report.inserted, "users");
      } catch (e) {
        bump(report.skipped, "users");
        report.errors.push(`user ${email}: ${e.message}`);
        userMap.delete(String(u._id));
      }
    } else {
      bump(report.inserted, "users");
    }
  }
}

async function copyAuths(src, tgt, userMap) {
  const rows = await src.collection("auths").find({}).toArray();
  for (const a of rows) {
    const newUserId = remapId(userMap, a.user_id);
    if (!newUserId) {
      bump(report.skipped, "auths");
      continue;
    }
    const existing = await tgt.collection("auths").findOne({ user_id: newUserId });
    if (existing) {
      bump(report.reused, "auths");
      continue;
    }
    const doc = { ...a, _id: new mongoose.Types.ObjectId(), user_id: newUserId };
    // drop refresh tokens — force re-login
    if (doc.refresh_tokens) doc.refresh_tokens = [];
    if (doc.refreshToken) doc.refreshToken = null;
    if (!DRY_RUN) {
      try {
        await tgt.collection("auths").insertOne(doc);
        bump(report.inserted, "auths");
      } catch (e) {
        bump(report.skipped, "auths");
        report.errors.push(`auth ${newUserId}: ${e.message}`);
      }
    } else bump(report.inserted, "auths");
  }
}

async function copyByUserRef(
  src,
  tgt,
  colName,
  userMap,
  brokerId,
  userField,
  extraRemap,
) {
  const rows = await src.collection(colName).find({}).toArray();
  for (const row of rows) {
    const oldUser = row[userField];
    const newUser = remapId(userMap, oldUser);
    if (!newUser) {
      bump(report.skipped, colName);
      continue;
    }
    let doc = { ...row, [userField]: newUser, brokerId };
    if (extraRemap) doc = extraRemap(doc, row) || doc;
    if (!doc) {
      bump(report.skipped, colName);
      continue;
    }

    // Prefer keep _id if free
    const idClash = await tgt.collection(colName).findOne({ _id: row._id });
    if (idClash) {
      // already migrated?
      if (String(idClash.brokerId) === String(brokerId)) {
        bump(report.reused, colName);
        continue;
      }
      doc._id = new mongoose.Types.ObjectId();
    }

    if (!DRY_RUN) {
      try {
        await tgt.collection(colName).insertOne(doc);
        bump(report.inserted, colName);
      } catch (e) {
        bump(report.skipped, colName);
        report.errors.push(`${colName} ${row._id}: ${e.message}`);
      }
    } else bump(report.inserted, colName);
  }
}

async function copyPlans(src, tgt, brokerId, planMap) {
  const rows = await src.collection("accountplans").find({}).toArray();
  for (const p of rows) {
    // Always insert a BLACKOS-owned copy — never steal DEFAULT plan docs.
    let name = p.name;
    const nameClash = await tgt.collection("accountplans").findOne({
      brokerId,
      name,
    });
    if (nameClash) {
      planMap.set(String(p._id), nameClash._id);
      bump(report.reused, "accountplans");
      continue;
    }

    const idClash = await tgt.collection("accountplans").findOne({ _id: p._id });
    const newId = idClash ? new mongoose.Types.ObjectId() : p._id;
    planMap.set(String(p._id), newId);
    const doc = { ...p, _id: newId, name, brokerId };
    if (!DRY_RUN) {
      try {
        await tgt.collection("accountplans").insertOne(doc);
        bump(report.inserted, "accountplans");
      } catch (e) {
        bump(report.skipped, "accountplans");
        report.errors.push(`plan ${p.name}: ${e.message}`);
        planMap.delete(String(p._id));
      }
    } else bump(report.inserted, "accountplans");
  }
}

async function copyAccounts(src, tgt, brokerId, userMap, planMap, accountMap) {
  const rows = await src.collection("accounts").find({}).toArray();
  for (const a of rows) {
    const newUser = remapId(userMap, a.user_id || a.user || a.userId);
    if (!newUser) {
      bump(report.skipped, "accounts");
      continue;
    }
    let planId = a.account_plan_id || a.plan || a.planId || a.account_plan || a.plan_id;
    if (planId && planMap.has(String(planId))) {
      planId = planMap.get(String(planId));
    }

    // account_number unique globally
    let account_number = a.account_number;
    if (account_number) {
      const clash = await tgt.collection("accounts").findOne({ account_number });
      if (clash) {
        if (String(clash.user_id || clash.user || clash.userId) === String(newUser)) {
          accountMap.set(String(a._id), clash._id);
          bump(report.reused, "accounts");
          if (!DRY_RUN) {
            await tgt
              .collection("accounts")
              .updateOne({ _id: clash._id }, { $set: { brokerId } });
          }
          continue;
        }
        account_number = `${account_number}-BO`;
        const clash2 = await tgt.collection("accounts").findOne({ account_number });
        if (clash2) {
          account_number = `${a.account_number}-${Date.now().toString().slice(-4)}`;
        }
      }
    }

    const idClash = await tgt.collection("accounts").findOne({ _id: a._id });
    const finalId = idClash ? new mongoose.Types.ObjectId() : a._id;
    accountMap.set(String(a._id), finalId);

    const doc = {
      ...a,
      _id: finalId,
      user_id: newUser,
      account_number,
      brokerId,
    };
    if (planId) doc.account_plan_id = planId;

    if (!DRY_RUN) {
      try {
        await tgt.collection("accounts").insertOne(doc);
        bump(report.inserted, "accounts");
      } catch (e) {
        bump(report.skipped, "accounts");
        report.errors.push(`account ${a.account_number}: ${e.message}`);
        accountMap.delete(String(a._id));
      }
    } else bump(report.inserted, "accounts");
  }
}

async function copyLinked(
  src,
  tgt,
  colName,
  brokerId,
  userMap,
  accountMap,
  opts = {},
) {
  const {
    userFields = ["user", "userId", "user_id"],
    accountFields = ["account", "accountId", "account_id"],
    idMap = null,
  } = opts;

  const rows = await src.collection(colName).find({}).toArray();
  for (const row of rows) {
    const doc = { ...row, brokerId };

    let userOk = true;
    for (const f of userFields) {
      if (row[f]) {
        const mapped = remapId(userMap, row[f]);
        if (!mapped) userOk = false;
        else doc[f] = mapped;
      }
    }
    for (const f of accountFields) {
      if (row[f]) {
        const mapped = remapId(accountMap, row[f]);
        if (!mapped) {
          // allow if no account required
          if (opts.requireAccount) userOk = false;
          else delete doc[f];
        } else doc[f] = mapped;
      }
    }
    if (!userOk) {
      bump(report.skipped, colName);
      continue;
    }

    const idClash = await tgt.collection(colName).findOne({ _id: row._id });
    if (idClash) {
      if (String(idClash.brokerId) === String(brokerId)) {
        bump(report.reused, colName);
        if (idMap) idMap.set(String(row._id), idClash._id);
        continue;
      }
      doc._id = new mongoose.Types.ObjectId();
    }
    if (idMap) idMap.set(String(row._id), doc._id);

    if (!DRY_RUN) {
      try {
        await tgt.collection(colName).insertOne(doc);
        bump(report.inserted, colName);
      } catch (e) {
        bump(report.skipped, colName);
        report.errors.push(`${colName} ${row._id}: ${e.message}`);
      }
    } else bump(report.inserted, colName);
  }
}

async function mergeCatalogue(src, tgt, colName, uniqueKey) {
  const rows = await src.collection(colName).find({}).toArray();
  for (const row of rows) {
    const keyVal = row[uniqueKey];
    if (keyVal == null) continue;
    const existing = await tgt.collection(colName).findOne({ [uniqueKey]: keyVal });
    if (existing) {
      bump(report.reused, colName);
      continue;
    }
    const idClash = await tgt.collection(colName).findOne({ _id: row._id });
    const doc = { ...row };
    if (idClash) doc._id = new mongoose.Types.ObjectId();
    if (!DRY_RUN) {
      try {
        await tgt.collection(colName).insertOne(doc);
        bump(report.inserted, colName);
      } catch (e) {
        bump(report.skipped, colName);
        report.errors.push(`${colName} ${keyVal}: ${e.message}`);
      }
    } else bump(report.inserted, colName);
  }
}

async function main() {
  if (!TARGET_URI) {
    console.error("MONGO_URI missing in .env");
    process.exit(1);
  }
  console.log("DRY_RUN=", DRY_RUN);
  console.log("SOURCE=", SOURCE_URI.replace(/:[^:@]+@/, ":***@"));
  console.log("TARGET=", TARGET_URI.replace(/:[^:@]+@/, ":***@"));

  const srcConn = await mongoose.createConnection(SOURCE_URI).asPromise();
  const tgtConn = await mongoose.createConnection(TARGET_URI).asPromise();
  const src = srcConn.db;
  const tgt = tgtConn.db;

  console.log("SRC db=", src.databaseName);
  console.log("TGT db=", tgt.databaseName);

  // Drop legacy unique index on accountplans.name if present
  try {
    const idxs = await tgt.collection("accountplans").indexes();
    for (const ix of idxs) {
      const keys = Object.keys(ix.key || {});
      if (ix.name !== "_id_" && keys.length === 1 && keys[0] === "name" && ix.unique) {
        console.log("Dropping legacy unique index", ix.name);
        if (!DRY_RUN) await tgt.collection("accountplans").dropIndex(ix.name);
      }
    }
    if (!DRY_RUN) {
      await tgt.collection("accountplans").createIndex(
        { brokerId: 1, name: 1 },
        { unique: true, name: "uniq_broker_plan_name" },
      );
    }
  } catch (e) {
    console.warn("index check:", e.message);
  }

  const defaultBroker = await ensureBroker(tgt, {
    code: "DEFAULT",
    displayName: "Default Broker",
  });
  const blackosBroker = await ensureBroker(tgt, {
    code: "BLACKOS",
    displayName: "BlackOS",
  });

  console.log("DEFAULT broker", defaultBroker._id.toString());
  console.log("BLACKOS broker", blackosBroker._id.toString());

  // Tag existing target operational data as DEFAULT
  await tagExistingWithBroker(tgt, defaultBroker._id, [
    "users",
    "accounts",
    "accountplans",
    "deposits",
    "withdrawals",
    "paymentmethods",
    "trades",
    "pendingorders",
    "transactions",
    "kycs",
  ]);

  // Existing target ADMIN users → DEFAULT membership + optional SuperAdmin
  const tgtAdmins = await tgt
    .collection("users")
    .find({ userType: "ADMIN" })
    .toArray();
  for (const admin of tgtAdmins) {
    const email = String(admin.email || "").toLowerCase();
    if (!DRY_RUN) {
      const $set = { brokerId: admin.brokerId || defaultBroker._id };
      if (email === SUPERADMIN_EMAIL) $set.platformRole = "SUPER_ADMIN";
      await tgt.collection("users").updateOne({ _id: admin._id }, { $set });
    }
    await upsertMembership(tgt, {
      brokerId: defaultBroker._id,
      userId: admin._id,
      role: "BROKER_ADMIN",
    });
  }

  const userMap = new Map();
  const planMap = new Map();
  const accountMap = new Map();

  console.log("Copying users…");
  await copyUsers(src, tgt, blackosBroker._id, userMap);

  console.log("Copying auths…");
  await copyAuths(src, tgt, userMap);

  console.log("Copying account plans…");
  await copyPlans(src, tgt, blackosBroker._id, planMap);

  console.log("Copying accounts…");
  await copyAccounts(src, tgt, blackosBroker._id, userMap, planMap, accountMap);

  console.log("Copying deposits / withdrawals / paymentmethods / kycs…");
  await copyLinked(src, tgt, "deposits", blackosBroker._id, userMap, accountMap, {
    requireAccount: false,
  });
  await copyLinked(src, tgt, "withdrawals", blackosBroker._id, userMap, accountMap, {
    requireAccount: false,
  });
  // paymentmethods: broker-scoped catalogue (no user required)
  {
    const rows = await src.collection("paymentmethods").find({}).toArray();
    for (const row of rows) {
      const existing = await tgt.collection("paymentmethods").findOne({
        brokerId: blackosBroker._id,
        title: row.title,
        type: row.type,
      });
      if (existing) {
        bump(report.reused, "paymentmethods");
        continue;
      }
      const idClash = await tgt.collection("paymentmethods").findOne({ _id: row._id });
      const doc = { ...row, brokerId: blackosBroker._id };
      if (idClash) doc._id = new mongoose.Types.ObjectId();
      if (!DRY_RUN) {
        try {
          await tgt.collection("paymentmethods").insertOne(doc);
          bump(report.inserted, "paymentmethods");
        } catch (e) {
          bump(report.skipped, "paymentmethods");
        }
      } else bump(report.inserted, "paymentmethods");
    }
  }

  await copyLinked(src, tgt, "kycs", blackosBroker._id, userMap, accountMap, {
    accountFields: [],
  });

  console.log("Copying trades / pendingorders / transactions…");
  await copyLinked(src, tgt, "trades", blackosBroker._id, userMap, accountMap, {
    userFields: ["userId", "user", "user_id"],
    accountFields: ["accountId", "account", "account_id"],
    requireAccount: false,
  });
  await copyLinked(
    src,
    tgt,
    "pendingorders",
    blackosBroker._id,
    userMap,
    accountMap,
    {
      userFields: ["userId", "user", "user_id"],
      accountFields: ["accountId", "account", "account_id"],
      requireAccount: false,
    },
  );
  await copyLinked(
    src,
    tgt,
    "transactions",
    blackosBroker._id,
    userMap,
    accountMap,
    {
      userFields: ["user", "userId", "user_id"],
      accountFields: ["account", "accountId", "account_id"],
      requireAccount: false,
    },
  );

  console.log("Merge instruments / symbols…");
  await mergeCatalogue(src, tgt, "instruments", "code");
  await mergeCatalogue(src, tgt, "symbols", "code");

  // Watchlist items (user scoped)
  try {
    await copyLinked(
      src,
      tgt,
      "watchlistitems",
      blackosBroker._id,
      userMap,
      accountMap,
      { accountFields: [], userFields: ["userId", "user", "user_id"] },
    );
  } catch (e) {
    report.errors.push(`watchlistitems: ${e.message}`);
  }

  // BlackOS ADMIN memberships
  for (const [oldId, newId] of userMap.entries()) {
    const u = await tgt.collection("users").findOne({ _id: newId });
    if (!u || u.userType !== "ADMIN") continue;
    await upsertMembership(tgt, {
      brokerId: blackosBroker._id,
      userId: newId,
      role: "BROKER_ADMIN",
    });
    bump(report.inserted, "brokermemberships");
  }

  // Ensure SuperAdmin on SUPERADMIN_EMAIL
  const sa = await tgt.collection("users").findOne({ email: SUPERADMIN_EMAIL });
  if (sa && !DRY_RUN) {
    await tgt.collection("users").updateOne(
      { _id: sa._id },
      {
        $set: {
          platformRole: "SUPER_ADMIN",
          userType: "ADMIN",
          isMailVerified: true,
          brokerId: sa.brokerId || blackosBroker._id,
        },
      },
    );
    await upsertMembership(tgt, {
      brokerId: blackosBroker._id,
      userId: sa._id,
      role: "BROKER_ADMIN",
    });
  }

  console.log("\n==== MIGRATE REPORT ====");
  console.log(JSON.stringify(report, null, 2));
  console.log("userMap size", userMap.size);
  console.log("planMap size", planMap.size);
  console.log("accountMap size", accountMap.size);

  await srcConn.close();
  await tgtConn.close();
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
