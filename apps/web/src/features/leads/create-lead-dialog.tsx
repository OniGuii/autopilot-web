"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createLead } from "@/features/leads/api";
import { LEAD_STATUSES, LEAD_STATUS_LABEL } from "@/features/leads/constants";
import { friendlyError } from "@/lib/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const schema = z.object({
  name: z.string().min(1, "Nome obrigatório").max(200),
  phone: z.string().min(8, "Telefone inválido").max(32),
  email: z.string().email("E-mail inválido").optional().or(z.literal("")),
  source: z.string().max(32).optional(),
  status: z.enum([
    "NEW",
    "CONTACTED",
    "RESPONDED",
    "QUALIFIED",
    "CONVERTED",
    "LOST",
  ]),
});

type FormValues = z.infer<typeof schema>;

export function CreateLeadDialog() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      phone: "",
      email: "",
      source: "WHATSAPP",
      status: "NEW",
    },
  });

  const mutation = useMutation({
    mutationFn: createLead,
    onSuccess: async () => {
      toast.success("Lead criado");
      setOpen(false);
      form.reset({
        name: "",
        phone: "",
        email: "",
        source: "WHATSAPP",
        status: "NEW",
      });
      await queryClient.invalidateQueries({ queryKey: ["leads"] });
      await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => {
      toast.error(friendlyError(error, "Não foi possível criar o lead."));
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Novo lead</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Criar lead</DialogTitle>
          <DialogDescription>
            Cadastre um novo contato na empresa ativa.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit((values) =>
            mutation.mutate({
              name: values.name,
              phone: values.phone,
              email: values.email || undefined,
              source: values.source || undefined,
              status: values.status,
            }),
          )}
        >
          <div className="space-y-2">
            <Label htmlFor="name">Nome</Label>
            <Input id="name" {...form.register("name")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="phone">Telefone</Label>
            <Input
              id="phone"
              placeholder="+55 11 99999-0001"
              {...form.register("phone")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" type="email" {...form.register("email")} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="source">Origem</Label>
            <Input id="source" {...form.register("source")} />
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select
              value={form.watch("status")}
              onValueChange={(value) =>
                form.setValue("status", value as FormValues["status"])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAD_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {LEAD_STATUS_LABEL[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button className="w-full" type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Salvando…" : "Criar lead"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
