import type {
  DyoorWorldAvatar,
  DyoorWorldProfile,
} from "@/lib/dyoor-world";
import type { DyoorWorldMessageAttachment } from "@/lib/dyoor-world-media";

export type DyoorWorldDirectMessage = {
  version: 1;
  id: string;
  conversationId: string;
  from: string;
  to: string;
  content: string;
  attachment?: DyoorWorldMessageAttachment;
  createdAt: string;
};

export type DyoorWorldDirectMessageView = DyoorWorldDirectMessage & {
  author: string;
  avatar: DyoorWorldAvatar | null;
};

export type DyoorWorldDirectConversationView = {
  conversationId: string;
  wallet: string;
  author: string;
  profile: DyoorWorldProfile | null;
  avatar: DyoorWorldAvatar | null;
  lastMessage: string;
  lastMessageAt: string;
  lastSender: string;
  unreadCount: number;
};
