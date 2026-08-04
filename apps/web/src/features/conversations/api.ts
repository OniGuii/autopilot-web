import { apiRequest } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type {
  Conversation,
  CreateConversationInput,
  CreateMessageInput,
  ListConversationsQuery,
  Message,
  Paginated,
} from "@/lib/api/types";

function toQuery(params: ListConversationsQuery) {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.leadId) search.set("leadId", params.leadId);
  if (params.assignedUserId) search.set("assignedUserId", params.assignedUserId);
  if (params.search) search.set("search", params.search);
  if (params.page) search.set("page", String(params.page));
  if (params.limit) search.set("limit", String(params.limit));
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export function listConversations(query: ListConversationsQuery = {}) {
  return apiRequest<Paginated<Conversation>>(
    `${endpoints.conversations.list}${toQuery(query)}`,
  );
}

export function getConversation(id: string) {
  return apiRequest<Conversation>(endpoints.conversations.byId(id));
}

export function createConversation(input: CreateConversationInput) {
  return apiRequest<Conversation>(endpoints.conversations.create, {
    method: "POST",
    body: input,
  });
}

export function closeConversation(id: string) {
  return apiRequest<Conversation>(endpoints.conversations.close(id), {
    method: "POST",
  });
}

export function createMessage(conversationId: string, input: CreateMessageInput) {
  return apiRequest<Message>(endpoints.conversations.messages(conversationId), {
    method: "POST",
    body: input,
  });
}
