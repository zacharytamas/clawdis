import { beforeEach, describe, expect, it, vi } from "vitest";

import { sendMessageMattermost } from "./send.js";

vi.mock("../web/media.js", () => ({
  loadWebMedia: vi.fn().mockResolvedValue({
    buffer: Buffer.from("img"),
    fileName: "photo.jpg",
    contentType: "image/jpeg",
    kind: "image",
  }),
}));

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  } as Response;
}

describe("sendMessageMattermost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends DMs by user id", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      const target = String(url);
      if (target.endsWith("/api/v4/users/me")) {
        return jsonResponse({ id: "bot1", username: "bot" });
      }
      if (target.endsWith("/api/v4/channels/direct")) {
        const body = JSON.parse(String(init?.body ?? "null"));
        expect(body).toEqual(["bot1", "user1"]);
        return jsonResponse({ id: "dm1" });
      }
      if (target.endsWith("/api/v4/posts")) {
        const payload = JSON.parse(String(init?.body ?? "null"));
        expect(payload).toEqual({ channel_id: "dm1", message: "hello" });
        return jsonResponse({ id: "post1", channel_id: "dm1" });
      }
      throw new Error(`Unexpected fetch ${target}`);
    }) as unknown as typeof fetch;

    const result = await sendMessageMattermost("user:user1", "hello", {
      baseUrl: "https://mm.local",
      token: "tok",
      fetchImpl: fetchMock,
    });

    expect(result).toEqual({ postId: "post1", channelId: "dm1" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer tok");
  });

  it("uploads media before posting", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      const target = String(url);
      if (target.endsWith("/api/v4/users/me")) {
        return jsonResponse({ id: "bot1", username: "bot" });
      }
      if (target.endsWith("/api/v4/channels/direct")) {
        const body = JSON.parse(String(init?.body ?? "null"));
        expect(body).toEqual(["bot1", "user1"]);
        return jsonResponse({ id: "dm1" });
      }
      if (target.endsWith("/api/v4/files")) {
        expect(init?.method).toBe("POST");
        const headers = new Headers(init?.headers);
        expect(headers.get("content-type")).not.toBe("application/json");
        expect(init?.body).toBeInstanceOf(FormData);
        const body = init?.body as FormData;
        expect(body.get("channel_id")).toBe("dm1");
        return jsonResponse({ file_infos: [{ id: "file1" }] });
      }
      if (target.endsWith("/api/v4/posts")) {
        const payload = JSON.parse(String(init?.body ?? "null"));
        expect(payload).toEqual({
          channel_id: "dm1",
          message: "hello",
          file_ids: ["file1"],
        });
        return jsonResponse({ id: "post1", channel_id: "dm1" });
      }
      throw new Error(`Unexpected fetch ${target}`);
    }) as unknown as typeof fetch;

    const result = await sendMessageMattermost("user:user1", "hello", {
      baseUrl: "https://mm.local",
      token: "tok",
      fetchImpl: fetchMock,
      mediaUrl: "file:///tmp/photo.jpg",
    });

    expect(result).toEqual({ postId: "post1", channelId: "dm1" });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("resolves @username to a DM channel", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      const target = String(url);
      if (target.endsWith("/api/v4/users/username/alice")) {
        return jsonResponse({ id: "u-alice" });
      }
      if (target.endsWith("/api/v4/users/me")) {
        return jsonResponse({ id: "bot2", username: "bot" });
      }
      if (target.endsWith("/api/v4/channels/direct")) {
        const body = JSON.parse(String(init?.body ?? "null"));
        expect(body).toEqual(["bot2", "u-alice"]);
        return jsonResponse({ id: "dm2" });
      }
      if (target.endsWith("/api/v4/posts")) {
        return jsonResponse({ id: "post2", channel_id: "dm2" });
      }
      throw new Error(`Unexpected fetch ${target}`);
    }) as unknown as typeof fetch;

    const result = await sendMessageMattermost("@alice", "hi", {
      baseUrl: "https://mm.local",
      token: "tok",
      fetchImpl: fetchMock,
    });

    expect(result.channelId).toBe("dm2");
    expect(result.postId).toBe("post2");
  });
});
