import { dbQueries } from './db/queries.js';
import { DiscordNotifier } from './discord.js';

export class Scheduler {
  constructor(trader) {
    this.trader = trader;
    this.discord = new DiscordNotifier();
    this.lastDailySummary = this.getLastDailySummaryDate();
    this.lastBiweeklyReport = this.getLastBiweeklyReportDate();
  }

  getLastDailySummaryDate() {
    // Check if we've sent a summary today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today.getTime();
  }

  getLastBiweeklyReportDate() {
    // Load from a state file or default to 14 days ago
    const twoWeeksAgo = Date.now() - (14 * 86400000);
    return twoWeeksAgo;
  }

  shouldSendDailySummary() {
    const now = Date.now();
    const currentHour = new Date().getHours();
    
    // Send daily summary at end of day (23:00-23:59)
    if (currentHour !== 23) return false;

    // Check if we already sent today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTime = today.getTime();

    if (this.lastDailySummary >= todayTime) {
      return false;
    }

    return true;
  }

  shouldSendBiweeklyReport() {
    const now = Date.now();
    const daysSinceLastReport = (now - this.lastBiweeklyReport) / 86400000;
    
    return daysSinceLastReport >= 14;
  }

  async checkScheduledTasks() {
    try {
      // Daily summary
      if (this.shouldSendDailySummary()) {
        console.log('[Scheduler] Sending daily summary...');
        const dailyStats = dbQueries.getDailyStats();
        const traderStats = this.trader.getStats();
        
        await this.discord.sendDailySummary({
          ...dailyStats,
          ...traderStats
        });

        this.lastDailySummary = Date.now();
      }

      // Biweekly report
      if (this.shouldSendBiweeklyReport()) {
        console.log('[Scheduler] Sending biweekly report...');
        const biweeklyStats = dbQueries.getBiweeklyStats();
        
        await this.discord.sendBiweeklyReport(biweeklyStats);

        this.lastBiweeklyReport = Date.now();
      }
    } catch (error) {
      console.error('[Scheduler] Error in scheduled tasks:', error);
    }
  }
}
