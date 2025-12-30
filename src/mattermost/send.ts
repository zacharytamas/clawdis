import { chunkText } from "../auto-reply/chunk.js";
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
};

export type MattermostSendResult = {
  postId: string;
  channelId: string;
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
  if (!text || !text.trim()) {
    throw new Error("Message must be non-empty for Mattermost sends");
  }
  const auth = resolveMattermostAuth({
    baseUrl: opts.baseUrl,
    token: opts.token,
  });
  const client = createMattermostClient(auth, opts.fetchImpl);
  const recipient = parseRecipient(to);
  const channelId = await resolveChannelId(client, recipient);
  const chunks = chunkText(text, MATTERMOST_TEXT_LIMIT);
  let lastPost: MattermostPost | null = null;
  for (const chunk of chunks) {
    if (!chunk.trim()) continue;
    lastPost = await client.request<MattermostPost>("/api/v4/posts", {
      method: "POST",
      body: JSON.stringify({
        channel_id: channelId,
        message: chunk,
      }),
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
