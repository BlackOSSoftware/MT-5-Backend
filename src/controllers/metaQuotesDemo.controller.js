import {
  loginMetaQuotesDemoService,
  registerMetaQuotesDemoService,
} from "../services/metaQuotesDemo.service.js";

const meta = (req) => ({
  ip: req.ip,
  device: req.headers["user-agent"] || "unknown",
});

export async function registerMetaQuotesDemoController(req, res) {
  try {
    const result = await registerMetaQuotesDemoService(
      req.body || {},
      meta(req),
    );
    return res.status(201).json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
}

export async function loginMetaQuotesDemoController(req, res) {
  try {
    const result = await loginMetaQuotesDemoService(req.body || {}, meta(req));
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
}
