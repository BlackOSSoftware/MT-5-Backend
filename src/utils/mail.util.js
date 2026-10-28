import nodemailer from "nodemailer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import Broker from "../models/Broker.model.js";

/* ======================================================
   PATH SETUP (ESM SAFE)
====================================================== */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATE_DIR = path.join(__dirname, "../templates/emails");

/* ======================================================
   BROKER SMTP RESOLUTION
   Default SMTP_* = FPTrade / BLACKOS
   SMTP_OCEANAPROFX_* = Oceana Pro FX
====================================================== */

const transporterCache = new Map();

function envKey(prefix, name) {
  if (!prefix) return process.env[name];
  return process.env[`${prefix}_${name}`] || process.env[name];
}

function smtpPrefixForBrokerCode(brokerCode) {
  const code = String(brokerCode || "")
    .trim()
    .toUpperCase();
  if (!code || code === "BLACKOS" || code === "DEFAULT") return "";
  // e.g. OCEANAPROFX → SMTP_OCEANAPROFX_HOST
  return `SMTP_${code}`;
}

function brandForBrokerCode(brokerCode) {
  const code = String(brokerCode || "")
    .trim()
    .toUpperCase();
  if (code === "OCEANAPROFX") {
    return {
      appName: process.env.APP_NAME_OCEANAPROFX || "Oceana Pro FX",
      frontendUrl:
        process.env.FRONTEND_URL_OCEANAPROFX ||
        process.env.FRONTEND_URL ||
        "",
    };
  }
  return {
    appName: process.env.APP_NAME || process.env.APP_NAME_BLACKOS || "FP Trades",
    frontendUrl: process.env.FRONTEND_URL || "",
  };
}

function buildSmtpConfig(brokerCode) {
  const prefix = smtpPrefixForBrokerCode(brokerCode);
  const host = envKey(prefix, "SMTP_HOST");
  const port = Number(envKey(prefix, "SMTP_PORT") || 465);
  const user = envKey(prefix, "SMTP_USER");
  const pass = envKey(prefix, "SMTP_PASS");
  const from = envKey(prefix, "SMTP_FROM");
  const secureRaw = envKey(prefix, "SMTP_SECURE");
  const secure =
    secureRaw != null && String(secureRaw).trim() !== ""
      ? String(secureRaw).toLowerCase() === "true"
      : port === 465;

  return { host, port, user, pass, from, secure, brokerCode: brokerCode || "DEFAULT" };
}

function getTransporter(brokerCode) {
  const cfg = buildSmtpConfig(brokerCode);
  const cacheKey = `${cfg.brokerCode}|${cfg.host}|${cfg.port}|${cfg.user}`;
  if (transporterCache.has(cacheKey)) {
    return { transporter: transporterCache.get(cacheKey), cfg };
  }

  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
  });
  transporterCache.set(cacheKey, transporter);
  return { transporter, cfg };
}

export async function resolveBrokerCode({
  brokerCode = null,
  brokerId = null,
} = {}) {
  if (brokerCode) return String(brokerCode).trim().toUpperCase();
  if (brokerId && mongoose.isValidObjectId(brokerId)) {
    const broker = await Broker.findById(brokerId).select("code").lean();
    if (broker?.code) return String(broker.code).toUpperCase();
  }
  return String(process.env.DEFAULT_BROKER_CODE || "BLACKOS")
    .trim()
    .toUpperCase();
}

export function getFrontendUrlForBroker(brokerCode) {
  return brandForBrokerCode(brokerCode).frontendUrl;
}

/* ======================================================
   TEMPLATE LOADER
====================================================== */

function loadTemplate(fileName, variables) {
  const filePath = path.join(TEMPLATE_DIR, fileName);
  let html = fs.readFileSync(filePath, "utf8");

  Object.keys(variables).forEach((key) => {
    const value = variables[key];
    html = html.replace(new RegExp(`{{${key}}}`, "g"), value);
  });

  return html;
}

/* ======================================================
   GENERIC SEND
====================================================== */

async function sendMail({ to, subject, html, brokerCode = null }) {
  const { transporter, cfg } = getTransporter(brokerCode);
  if (!cfg.host || !cfg.user || !cfg.pass) {
    throw new Error(
      `SMTP not configured for broker ${cfg.brokerCode || "DEFAULT"}`
    );
  }
  return transporter.sendMail({
    from: cfg.from || cfg.user,
    to,
    subject,
    html,
  });
}

export async function sendEmailVerificationMail(
  email,
  verifyLink,
  { brokerCode = null, brokerId = null } = {}
) {
  const code = await resolveBrokerCode({ brokerCode, brokerId });
  const brand = brandForBrokerCode(code);
  const html = loadTemplate("email-verify.html", {
    APP_NAME: brand.appName,
    VERIFY_LINK: verifyLink,
    YEAR: new Date().getFullYear(),
  });

  return sendMail({
    to: email,
    subject: "Confirm your email address",
    html,
    brokerCode: code,
  });
}

export async function sendResetPasswordMail(
  email,
  resetLink,
  { brokerCode = null, brokerId = null } = {}
) {
  const code = await resolveBrokerCode({ brokerCode, brokerId });
  const brand = brandForBrokerCode(code);
  const html = loadTemplate("reset-password.html", {
    APP_NAME: brand.appName,
    RESET_LINK: resetLink,
    YEAR: new Date().getFullYear(),
  });

  return sendMail({
    to: email,
    subject: "Reset Password",
    html,
    brokerCode: code,
  });
}

export async function sendAccountCreatedMail({
  email,
  accountNumber,
  accountType,
  planName,
  tradePassword,
  watchPassword,
  brokerCode = null,
  brokerId = null,
}) {
  const code = await resolveBrokerCode({ brokerCode, brokerId });
  const brand = brandForBrokerCode(code);
  const html = loadTemplate("account-created.html", {
    APP_NAME: brand.appName,
    ACCOUNT_NUMBER: accountNumber,
    ACCOUNT_TYPE: String(accountType || "").toUpperCase(),
    PLAN_NAME: planName,
    TRADE_PASSWORD: tradePassword,
    WATCH_PASSWORD: watchPassword,
    YEAR: new Date().getFullYear(),
  });

  return sendMail({
    to: email,
    subject: "Your Trading Account is Ready",
    html,
    brokerCode: code,
  });
}
