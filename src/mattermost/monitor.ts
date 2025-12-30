import WebSocket from "ws";

import { formatAgentEnvelope } from "../auto-reply/envelope.js";
import { getReplyFromConfig } from "../auto-reply/reply.js";
import type { ReplyPayload } from "../auto-reply/types.js";
import { loadConfig } from "../config/config.js";
import { resolveStorePath, updateLastRoute } from "../config/sessions.js";
import { danger, isVerbose, logVerbose } from "../globals.js";
import { rawDataToString } from "../infra/ws.js";
import { getChildLogger } from "../logging.js";
import type { RuntimeEnv } from "../runtime.js";
import {
  createMattermostClient,
  resolveMattermostAuth,
  resolveMattermostWsUrl,
} from "./client.js";
import { sendMessageMattermost } from "./send.js";

type MattermostPost = {
  id?: string;
  channel_id?: string;
  user_id?: string;
  message?: string;
  create_at?: number;
  delete_at?: number;
};

type MattermostEvent = {
  event?: string;
  data?: {
    post?: string;
    channel_id?: string;
    channel_type?: string;
    channel_display_name?: string;
    channel_name?: string;
    sender_name?: string;
  };
};

type MattermostUser = {
  id?: string;
  username?: string;
  nickname?: string;
};

type AllowList = {
  allowAll: boolean;
  ids: Set<string>;
  usernames: Set<string>;
};

export type MonitorMattermostOpts = {
  baseUrl?: string;
  token?: string;
  wsUrl?: string;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  requireMention?: boolean;
  allowFrom?: Array<string | number>;
  fetchImpl?: typeof fetch;
};

const MEDIA_UNSUPPORTED_TEXT =
  "Media omitted (Mattermost uploads not configured).";

function normalizeAllowList(raw?: Array<string | number>): AllowList | null {
  if (!raw || raw.length === 0) return null;
  const ids = new Set<string>();
  const usernames = new Set<string>();
  let allowAll = false;
  for (const entry of raw) {
    const cleaned = String(entry).trim();
    if (!cleaned) continue;
    if (cleaned === "*") {
      allowAll = true;
      continue;
    }
    if (cleaned.startsWith("@")) {
      usernames.add(cleaned.slice(1).toLowerCase());
      continue;
    }
    if (cleaned.startsWith("user:")) {
      ids.add(cleaned.slice("user:".length));
      continue;
    }
    ids.add(cleaned);
  }
  return { allowAll, ids, usernames };
}

function isAllowedSender(
  allow: AllowList | null,
  userId: string | undefined,
  username: string | undefined,
): boolean {
  if (!allow) return true;
  if (allow.allowAll) return true;
  if (userId && allow.ids.has(userId)) return true;
  if (username && allow.usernames.has(username.toLowerCase())) return true;
  return false;
}

function buildDirectLabel(username: string | undefined, userId: string) {
  const name = username
    ? username.startsWith("@")
      ? username
      : `@${username}`
    : undefined;
  return name ? `${name} id:${userId}` : `id:${userId}`;
}

function buildChannelLabel(
  channelName: string | undefined,
  channelId: string,
) {
  const name = channelName ? `#${channelName}` : "channel";
  return `${name} id:${channelId}`;
}

function wasMentioned(
  body: string,
  botUsername: string | undefined,
  mentionPatterns: string[],
): boolean {
  const lower = body.toLowerCase();
  if (botUsername && lower.includes(`@${botUsername.toLowerCase()}`)) {
    return true;
  }
  for (const pattern of mentionPatterns) {
    try {
      const re = new RegExp(pattern, "i");
      if (re.test(body)) return true;
    } catch {
      // ignore invalid regex
    }
  }
  return false;
}

async function deliverReplies(params: {
  replies: ReplyPayload[];
  channelId: string;
  baseUrl: string;
  token: string;
  fetchImpl?: typeof fetch;
  runtime: RuntimeEnv;
}) {
  const { replies, channelId, baseUrl, token, fetchImpl, runtime } = params;
  for (const reply of replies) {
    const mediaList =
      reply.mediaUrls ?? (reply.mediaUrl ? [reply.mediaUrl] : []);
    let text = reply.text ?? "";
    if (!text && mediaList.length > 0) {
      text = MEDIA_UNSUPPORTED_TEXT;
    }
    if (!text.trim()) continue;
    if (mediaList.length > 0 && isVerbose()) {
      logVerbose(
        `mattermost reply had media; sending text-only to channel ${channelId}`,
      );
    }
    await sendMessageMattermost(`channel:${channelId}`, text, {
      baseUrl,
      token,
      fetchImpl,
    });
    runtime.log?.(`mattermost: delivered reply to channel ${channelId}`);
  }
}

export async function monitorMattermostProvider(
  opts: MonitorMattermostOpts = {},
) {
  const cfg = loadConfig();
  const auth = resolveMattermostAuth({
    baseUrl: opts.baseUrl ?? cfg.mattermost?.baseUrl,
    token: opts.token ?? cfg.mattermost?.token,
    cfg,
  });
  const wsUrl = resolveMattermostWsUrl({
    baseUrl: auth.baseUrl,
    wsUrl: opts.wsUrl ?? cfg.mattermost?.wsUrl ?? process.env.MATTERMOST_WS_URL,
  });
  const runtime: RuntimeEnv = opts.runtime ?? {
    log: console.log,
    error: console.error,
    exit: (code: number): never => {
      throw new Error(`exit ${code}`);
    },
  };

  const client = createMattermostClient(auth, opts.fetchImpl);
  const me = await client.request<MattermostUser>("/api/v4/users/me");
  const botUserId = me.id ?? "";
  const botUsername = me.username ?? me.nickname ?? undefined;
  if (!botUserId) {
    throw new Error("Mattermost /users/me returned no id");
  }

  const requireMention =
    opts.requireMention ?? cfg.mattermost?.requireMention ?? true;
  const allowList = normalizeAllowList(
    opts.allowFrom ?? cfg.mattermost?.allowFrom,
  );
  const mentionPatterns = cfg.routing?.groupChat?.mentionPatterns ?? [];
  const logger = getChildLogger({ module: "mattermost-auto-reply" });
  const ws = new WebSocket(`${wsUrl}/api/v4/websocket`, {
    headers: { Authorization: `Bearer ${auth.token}` },
    handshakeTimeout: 5000,
  });
  let aborted = false;
  let seq = 1;

  const handleMessage = async (data: WebSocket.RawData) => {
    let parsed: MattermostEvent;
    try {
      parsed = JSON.parse(rawDataToString(data)) as MattermostEvent;
    } catch {
      return;
    }
    if (parsed.event !== "posted") return;
    const payload = parsed.data;
    const postRaw = payload?.post;
    if (!postRaw) return;
    let post: MattermostPost;
    try {
      post = JSON.parse(postRaw) as MattermostPost;
    } catch {
      return;
    }
    if (!post.channel_id || !post.user_id || !post.message) return;
    if (post.delete_at && post.delete_at > 0) return;
    if (post.user_id === botUserId) return;

    const channelType = payload?.channel_type ?? "";
    const isDirect = channelType === "D";
    const senderName = payload?.sender_name?.trim() || undefined;
    if (isDirect) {
      const allowed = isAllowedSender(allowList, post.user_id, senderName);
      if (!allowed) {
        logVerbose(
          `Blocked unauthorized mattermost sender ${post.user_id} (not in allowFrom)`,
        );
        return;
      }
    }

    const mentionHit = wasMentioned(
      post.message,
      botUsername,
      mentionPatterns,
    );
    if (!isDirect && requireMention && !mentionHit) {
      logger.info(
        {
          channelId: post.channel_id,
          reason: "no-mention",
        },
        "mattermost: skipping channel message",
      );
      return;
    }

    const fromLabel = isDirect
      ? buildDirectLabel(senderName, post.user_id)
      : buildChannelLabel(
          payload?.channel_display_name ?? payload?.channel_name,
          post.channel_id,
        );
    const body = formatAgentEnvelope({
      surface: "Mattermost",
      from: fromLabel,
      timestamp: post.create_at,
      body: post.message,
    });
    const ctxPayload = {
      Body: body,
      From: isDirect ? `mattermost:${post.user_id}` : `group:${post.channel_id}`,
      To: `channel:${post.channel_id}`,
      ChatType: isDirect ? "direct" : "group",
      GroupSubject: isDirect
        ? undefined
        : payload?.channel_display_name ?? payload?.channel_name,
      SenderName: senderName ?? undefined,
      Surface: "mattermost" as const,
      WasMentioned: mentionHit,
      MessageSid: post.id,
      Timestamp: post.create_at,
    };

    if (isDirect) {
      const sessionCfg = cfg.session;
      const mainKey = (sessionCfg?.mainKey ?? "main").trim() || "main";
      const storePath = resolveStorePath(sessionCfg?.store);
      await updateLastRoute({
        storePath,
        sessionKey: mainKey,
        channel: "mattermost",
        to: `user:${post.user_id}`,
      });
    }

    if (isVerbose()) {
      const preview = body.slice(0, 200).replace(/\n/g, "\\n");
      logVerbose(
        `mattermost inbound: channel=${post.channel_id} from=${ctxPayload.From} preview="${preview}"`,
      );
    }

    const replyResult = await getReplyFromConfig(ctxPayload, undefined, cfg);
    const replies = replyResult
      ? Array.isArray(replyResult)
        ? replyResult
        : [replyResult]
      : [];
    if (replies.length === 0) return;

    await deliverReplies({
      replies,
      channelId: post.channel_id,
      baseUrl: auth.baseUrl,
      token: auth.token,
      fetchImpl: opts.fetchImpl,
      runtime,
    });
  };

  ws.on("open", () => {
    const authMsg = {
      seq: seq++,
      action: "authentication_challenge",
      data: { token: auth.token },
    };
    ws.send(JSON.stringify(authMsg));
  });

  ws.on("message", (data) => {
    void handleMessage(data).catch((err) => {
      runtime.error?.(danger(`Mattermost handler failed: ${String(err)}`));
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      aborted = true;
      ws.close();
      resolve();
    };
    const onClose = (code: number, reason: Buffer) => {
      cleanup();
      if (aborted) {
        resolve();
        return;
      }
      const note = reason?.toString() ? `: ${reason.toString()}` : "";
      reject(new Error(`mattermost websocket closed (${code})${note}`));
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      opts.abortSignal?.removeEventListener("abort", onAbort);
      ws.off("close", onClose);
      ws.off("error", onError);
    };
    opts.abortSignal?.addEventListener("abort", onAbort, { once: true });
    ws.on("close", onClose);
    ws.on("error", onError);
  });
}
