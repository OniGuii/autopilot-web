import { apiRequest } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { SendWhatsAppInput, WhatsAppStatus } from "@/lib/api/types";

export function getWhatsAppStatus() {
  return apiRequest<WhatsAppStatus>(endpoints.whatsapp.status);
}

export function connectWhatsApp() {
  return apiRequest<WhatsAppStatus>(endpoints.whatsapp.connect, {
    method: "POST",
  });
}

export function disconnectWhatsApp() {
  return apiRequest<WhatsAppStatus>(endpoints.whatsapp.disconnect, {
    method: "POST",
  });
}

export function sendWhatsAppMessage(input: SendWhatsAppInput) {
  return apiRequest<unknown>(endpoints.whatsapp.send, {
    method: "POST",
    body: input,
  });
}
