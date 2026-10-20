import express from "express";

import {
  loginMetaQuotesDemoController,
  registerMetaQuotesDemoController,
} from "../../controllers/metaQuotesDemo.controller.js";

const router = express.Router();

// MetaQuotes demo accounts: registration is saved in Mongo
// (metaquotes_demo_accounts), trading stays local in the app.
router.post("/demo/register", registerMetaQuotesDemoController);
router.post("/demo/login", loginMetaQuotesDemoController);

export default router;
