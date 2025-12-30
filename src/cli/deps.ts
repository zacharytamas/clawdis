import { sendMessageDiscord } from "../discord/send.js";
import { sendMessageMattermost } from "../mattermost/send.js";
import { logWebSelfId, sendMessageWhatsApp } from "../providers/web/index.js";
import { sendMessageTelegram } from "../telegram/send.js";

export type CliDeps = {
  sendMessageWhatsApp: typeof sendMessageWhatsApp;
  sendMessageTelegram: typeof sendMessageTelegram;
  sendMessageDiscord: typeof sendMessageDiscord;
  sendMessageMattermost: typeof sendMessageMattermost;
};

export function createDefaultDeps(): CliDeps {
  return {
    sendMessageWhatsApp,
    sendMessageTelegram,
    sendMessageDiscord,
    sendMessageMattermost,
  };
}

export { logWebSelfId };
