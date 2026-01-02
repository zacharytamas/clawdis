import { chunkText } from "../auto-reply/chunk.js";
import { loadConfig } from "../config/config.js";
import { extensionForMime } from "../media/mime.js";
import { loadWebMedia } from "../web/media.js";
import { createMattermostClient, resolveMattermostAuth } from "./client.js";

const MATTERMOST_TEXT_LIMIT = 500;

type MattermostRecipient =
  | { kind: "channel"; id: string }
  | { kind: "user"; id: string }
  | { kind: "username"; username: string };

type MattermostUser = {
  id: string;
  username?: string;
};

type MattermostChannel = {
  id: string;
};

type MattermostPost = {
  id?: string;
  channel_id?: string;
};

export type MattermostSendOpts = {
  baseUrl?: string;
  token?: string;
  fetchImpl?: typeof fetch;
  mediaUrl?: string;
  mediaUrls?: string[];
  maxBytes?: number;
};

export type MattermostSendResult = {
  postId: string;
  channelId: string;
};

type MattermostFileUploadResponse = {
  file_infos?: Array<{ id?: string }>;
  file_ids?: string[];
};

function parseRecipient(raw: string): MattermostRecipient {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Recipient is required for Mattermost sends");
  }
  if (trimmed.startsWith("channel:")) {
    return { kind: "channel", id: trimmed.slice("channel:".length) };
  }
  if (trimmed.startsWith("user:")) {
    return { kind: "user", id: trimmed.slice("user:".length) };
  }
  if (trimmed.startsWith("@")) {
    return { kind: "username", username: trimmed.slice(1) };
  }
  return { kind: "channel", id: trimmed };
}

async function resolveUserId(
  client: ReturnType<typeof createMattermostClient>,
  username: string,
): Promise<string> {
  const user = await client.request<MattermostUser>(
    `/api/v4/users/username/${encodeURIComponent(username)}`,
  );
  if (!user?.id) {
    throw new Error(`Mattermost user not found: @${username}`);
  }
  return user.id;
}

async function resolveDirectChannelId(
  client: ReturnType<typeof createMattermostClient>,
  userId: string,
): Promise<string> {
  const me = await client.request<MattermostUser>("/api/v4/users/me");
  if (!me?.id) {
    throw new Error("Mattermost /users/me returned no id");
  }
  const channel = await client.request<MattermostChannel>(
    "/api/v4/channels/direct",
    {
      method: "POST",
      body: JSON.stringify([me.id, userId]),
    },
  );
  if (!channel?.id) {
    throw new Error("Failed to create Mattermost DM channel");
  }
  return channel.id;
}

async function resolveChannelId(
  client: ReturnType<typeof createMattermostClient>,
  recipient: MattermostRecipient,
): Promise<string> {
  if (recipient.kind === "channel") return recipient.id;
  const userId =
    recipient.kind === "user"
      ? recipient.id
      : await resolveUserId(client, recipient.username);
  return await resolveDirectChannelId(client, userId);
}

export async function sendMessageMattermost(
  to: string,
  text: string,
  opts: MattermostSendOpts = {},
): Promise<MattermostSendResult> {
  const cfg = loadConfig();
  const auth = resolveMattermostAuth({
    baseUrl: opts.baseUrl,
    token: opts.token,
    cfg,
  });
  const client = createMattermostClient(auth, opts.fetchImpl);
  const recipient = parseRecipient(to);
  const channelId = await resolveChannelId(client, recipient);
  const mediaUrls = [
    ...(opts.mediaUrl ? [opts.mediaUrl] : []),
    ...(opts.mediaUrls ?? []),
  ]
    .map((url) => url.trim())
    .filter((url) => url.length > 0);
  if (!text?.trim() && mediaUrls.length === 0) {
    throw new Error("Message must be non-empty for Mattermost sends");
  }
  const maxBytes =
    opts.maxBytes ??
    (cfg.mattermost?.mediaMaxMb
      ? cfg.mattermost.mediaMaxMb * 1024 * 1024
      : undefined);
  const fileIds = mediaUrls.length
    ? await uploadMedia(client, channelId, mediaUrls, maxBytes)
    : [];
  const hasText = Boolean(text?.trim());
  const chunks = hasText ? chunkText(text, MATTERMOST_TEXT_LIMIT) : [""];
  let lastPost: MattermostPost | null = null;
  let first = true;
  for (const chunk of chunks) {
    if (!chunk.trim() && fileIds.length === 0) continue;
    const payload: {
      channel_id: string;
      message: string;
      file_ids?: string[];
    } = {
      channel_id: channelId,
      message: chunk,
    };
    if (first && fileIds.length > 0) {
      payload.file_ids = fileIds;
    }
    first = false;
    lastPost = await client.request<MattermostPost>("/api/v4/posts", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }
  if (!lastPost) {
    throw new Error("Mattermost send failed (empty message)");
  }
  return {
    postId: lastPost.id ? String(lastPost.id) : "unknown",
    channelId: String(lastPost.channel_id ?? channelId),
  };
}

async function uploadMedia(
  client: ReturnType<typeof createMattermostClient>,
  channelId: string,
  mediaUrls: string[],
  maxBytes?: number,
): Promise<string[]> {
  const fileIds: string[] = [];
  for (const mediaUrl of mediaUrls) {
    const media = await loadWebMedia(mediaUrl, maxBytes);
    const filename =
      media.fileName ?? `upload${extensionForMime(media.contentType) ?? ""}`;
    const form = new FormData();
    form.append("channel_id", channelId);
    const contentType = media.contentType ?? "application/octet-stream";
    const blob =
      typeof Blob !== "undefined"
        ? new Blob([media.buffer], { type: contentType })
        : media.buffer;
    form.append("files", blob, filename);
    const response = await client.request<MattermostFileUploadResponse>(
      "/api/v4/files",
      {
        method: "POST",
        body: form,
      },
    );
    const ids =
      response.file_ids?.map((id) => String(id)).filter(Boolean) ??
      response.file_infos
        ?.map((info) => info.id)
        .filter((id): id is string => Boolean(id)) ??
      [];
    if (ids.length === 0) {
      throw new Error("Mattermost upload failed (no file ids)");
    }
    fileIds.push(...ids);
  }
  return fileIds;
}
