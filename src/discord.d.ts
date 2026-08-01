export interface DiscordNotifier {
  enabled: boolean;
  send(content: string, embeds?: any | any[]): Promise<void>;
  sendStartup(): Promise<void>;
  sendTrade(trade: any): Promise<void>;
  sendDailySummary(stats: any): Promise<void>;
  sendBiweeklyReport(stats: any): Promise<void>;
  sendError(error: { message: string }): Promise<void>;
}

export declare const DiscordNotifier: {
  new (): DiscordNotifier;
};