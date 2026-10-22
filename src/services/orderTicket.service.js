import OrderTicketCounter from "../models/OrderTicketCounter.model.js";

const FIRST_TICKET = 10000000000;
const LAST_TICKET = 99999999999;

// Deals ka alag namespace (MT5 jaisa) - order numbers se takraye nahi.
const FIRST_DEAL_TICKET = 50000000000;

async function nextFromCounter(id, first) {
  const counter = await OrderTicketCounter.findOneAndUpdate(
    { _id: id },
    { $inc: { value: 1 } },
    { new: true, upsert: true },
  );
  const ticket = first - 1 + counter.value;
  if (ticket > LAST_TICKET) {
    throw new Error(`Ticket range exhausted (${id})`);
  }
  return ticket;
}

export function nextOrderTicket() {
  return nextFromCounter("orders", FIRST_TICKET);
}

export function nextDealTicket() {
  return nextFromCounter("deals", FIRST_DEAL_TICKET);
}
