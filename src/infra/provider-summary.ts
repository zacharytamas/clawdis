import chalk from "chalk";
import { type ClawdisConfig, loadConfig } from "../config/config.js";
import { resolveTelegramToken } from "../telegram/token.js";
import { normalizeE164 } from "../utils.js";
import {
  getWebAuthAgeMs,
  readWebSelfId,
  webAuthExists,
} from "../web/session.js";

export async function buildProviderSummary(
  cfg?: ClawdisConfig,
): Promise<string[]> {
  const effective = cfg ?? loadConfig();
  const lines: string[] = [];

  const webEnabled = effective.web?.enabled !== false;
  if (!webEnabled) {
    lines.push(chalk.cyan("WhatsApp: disabled"));
  } else {
    const webLinked = await webAuthExists();
    const authAgeMs = getWebAuthAgeMs();
    const authAge = authAgeMs === null ? "unknown" : formatAge(authAgeMs);
    const { e164 } = readWebSelfId();
    lines.push(
      webLinked
        ? chalk.green(
            `WhatsApp: linked${e164 ? ` as ${e164}` : ""} (auth ${authAge})`,
          )
        : chalk.red("WhatsApp: not linked"),
    );
  }

  const telegramEnabled = effective.telegram?.enabled !== false;
  if (!telegramEnabled) {
    lines.push(chalk.cyan("Telegram: disabled"));
  } else {
    const { token: telegramToken } = resolveTelegramToken(effective);
    const telegramConfigured = Boolean(telegramToken);
    lines.push(
      telegramConfigured
        ? chalk.green("Telegram: configured")
        : chalk.cyan("Telegram: not configured"),
    );
  }

  const mattermostEnabled = effective.mattermost?.enabled !== false;
  if (!mattermostEnabled) {
    lines.push(chalk.cyan("Mattermost: disabled"));
  } else {
    const baseUrl =
      process.env.MATTERMOST_URL ?? effective.mattermost?.baseUrl;
    const token =
      process.env.MATTERMOST_TOKEN ?? effective.mattermost?.token;
    const host = (() => {
      if (!baseUrl) return "";
      try {
        return new URL(baseUrl).host;
      } catch {
        return "";
      }
    })();
    const label = host ? `Mattermost: configured (${host})` : "Mattermost: configured";
    lines.push(
      baseUrl && token ? chalk.green(label) : chalk.cyan("Mattermost: not configured"),
    );
  }

  const signalEnabled = effective.signal?.enabled !== false;
  if (!signalEnabled) {
    lines.push(chalk.cyan("Signal: disabled"));
  } else {
    const signalConfigured = Boolean(
      effective.signal?.httpUrl ||
        effective.signal?.cliPath ||
        effective.signal?.account,
    );
    lines.push(
      signalConfigured
        ? chalk.green("Signal: configured")
        : chalk.cyan("Signal: not configured"),
    );
  }

  const imessageEnabled = effective.imessage?.enabled !== false;
  if (!imessageEnabled) {
    lines.push(chalk.cyan("iMessage: disabled"));
  } else {
    const imessageConfigured = Boolean(effective.imessage);
    lines.push(
      imessageConfigured
        ? chalk.green("iMessage: configured")
        : chalk.cyan("iMessage: not configured"),
    );
  }

  const allowFrom = effective.routing?.allowFrom?.length
    ? effective.routing.allowFrom.map(normalizeE164).filter(Boolean)
    : [];
  if (allowFrom.length) {
    lines.push(chalk.cyan(`AllowFrom: ${allowFrom.join(", ")}`));
  }

  return lines;
}

export function formatAge(ms: number): string {
  if (ms < 0) return "unknown";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
