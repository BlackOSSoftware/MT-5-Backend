import {
  loginMetaQuotesDemoService,
  registerMetaQuotesDemoService,
} from "../services/metaQuotesDemo.service.js";

export async function registerMetaQuotesDemoController(req, res) {
  try {
    const result = await registerMetaQuotesDemoService(req.body || {});
    return res.status(201).json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
}

export async function loginMetaQuotesDemoController(req, res) {
  try {
    const result = await loginMetaQuotesDemoService(req.body || {});
    return res.json(result);
  } catch (err) {
    return res.status(400).json({ message: err.message });
  }
}
