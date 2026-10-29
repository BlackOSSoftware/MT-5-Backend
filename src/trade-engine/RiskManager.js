import { sendUserNotification } from "../services/notification.service.js";
import {
  DEFAULT_RISK,
  getCachedRiskForBroker,
} from "../services/brokerRisk.service.js";

export class RiskManager {
  static calcMargin({ price, volume, contractSize, leverage }) {
    return (price * volume * contractSize) / leverage;
  }

  static marginLevel(account) {
    if (account.usedMargin <= 0) return 1000;
    return (account.equity / account.usedMargin) * 100;
  }

  static cashEquity(account) {
    const direct = Number(account?.cashEquity);
    if (Number.isFinite(direct)) return direct;

    const equity = Number(account?.equity);
    const bonusLive = Number(account?.bonus_live);
    if (Number.isFinite(equity) && Number.isFinite(bonusLive)) {
      return equity - bonusLive;
    }

    return Number(account?.balance) || 0;
  }

  static capitalExhausted(account) {
    return (Number(account?.equity) || 0) <= 0;
  }

  /** Per-broker thresholds (FP 100% stop-out, Oceana 90%, …). */
  static thresholds(account) {
    const cached = getCachedRiskForBroker(account?.brokerId);
    const warning = Number(
      account?.risk_warning_percent ?? cached.warning_loss_percent,
    );
    const stopOut = Number(
      account?.risk_stop_out_percent ?? cached.stop_out_loss_percent,
    );
    return {
      warning_loss_percent: Number.isFinite(warning)
        ? warning
        : DEFAULT_RISK.warning_loss_percent,
      stop_out_loss_percent: Number.isFinite(stopOut)
        ? stopOut
        : DEFAULT_RISK.stop_out_loss_percent,
    };
  }

  // ===============================
  // LOSS % of (real + bonus) vs equity
  // ===============================
  static lossPercent(account) {
    const realBalance = Number(account?.balance) || 0;
    const bonusBalance = Number(account?.bonus_balance) || 0;
    const totalBalance = realBalance + bonusBalance;
    const equity = Number(account?.equity) || 0;

    if (totalBalance <= 0) return equity <= 0 ? 100 : 0;

    const loss = totalBalance - equity;
    if (loss <= 0) return 0;
    return (loss / totalBalance) * 100;
  }

  // ===============================
  // WARNING (broker-configurable)
  // ===============================
  static async checkWarning(account) {
    const loss = this.lossPercent(account);
    const { warning_loss_percent, stop_out_loss_percent } =
      this.thresholds(account);

    if (account.__riskWarned) return;

    // Warn in [warning, stopOut) — at stopOut we close instead.
    if (loss >= warning_loss_percent && loss < stop_out_loss_percent) {
      account.__riskWarned = true;
      try {
        await sendUserNotification({
          userId: account.userId,
          title: "Risk Warning",
          message: `Your account is in ${loss.toFixed(
            2,
          )}% loss. Positions force-close at ${stop_out_loss_percent}%.`,
          data: {
            type: "RISK_WARNING",
            accountId: account.accountId,
            loss: String(loss.toFixed(2)),
            warningPercent: String(warning_loss_percent),
            stopOutPercent: String(stop_out_loss_percent),
          },
        });
      } catch (err) {
        console.error("Risk warning failed:", err);
      }
    }
  }

  // ===============================
  // STOP-OUT (broker-configurable)
  // ===============================
  static shouldStopOut(account) {
    if (this.capitalExhausted(account)) {
      return true;
    }

    const loss = this.lossPercent(account);
    const { stop_out_loss_percent } = this.thresholds(account);
    return loss >= stop_out_loss_percent;
  }
}
