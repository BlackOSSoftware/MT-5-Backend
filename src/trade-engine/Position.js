// src/trade-engine/Position.js
export class Position {
  constructor({
    positionId,
    ticket,
    accountId,
    symbol,
    side,
    volume,
    openPrice,
    contractSize,
    leverage,
    stopLoss,
    takeProfit,
  }) {
    this.positionId = positionId;
    this.ticket = ticket;
    this.accountId = accountId;
    this.symbol = symbol;
    this.side = side;

    this.volume = volume;
    this.openPrice = openPrice;
    this.contractSize = contractSize;
    this.leverage = leverage;

    this.stopLoss = stopLoss || null;
    this.takeProfit = takeProfit || null;

    this.marginUsed = 0;
    this.floatingPnL = 0;
    this.openTime = Date.now();
  }

  updatePnL(bid, ask, contractSizeOverride) {
    const csRaw =
      typeof contractSizeOverride === "number" &&
      Number.isFinite(contractSizeOverride) &&
      contractSizeOverride > 0
        ? contractSizeOverride
        : this.contractSize;

    const cs = Number.isFinite(Number(csRaw)) && Number(csRaw) > 0 ? Number(csRaw) : 1;

    this.contractSize = cs;

    if (this.side === "BUY") {
      this.floatingPnL = (bid - this.openPrice) * this.volume * cs;
    } else {
      this.floatingPnL = (this.openPrice - ask) * this.volume * cs;
    }
  }
}
