"use client";

/**
 * Every write the Operations views make, with an Undo on the toast.
 *
 * The server answers each change with the previous state, so undo is an exact
 * restore rather than a guess. Every mutation invalidates the whole
 * `["operations"]` family plus `["tasks"]`: one relabel can move an item
 * between home sections, the portfolio and the people view at once.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { restorePatch, type OpsPatch } from "@/lib/operations/fields";
import type { OpsFields, OpsItem } from "@/lib/operations/types";

interface PatchBody {
  ops?: OpsPatch;
  status?: OpsItem["status"];
  dueDate?: string | null;
  projectId?: string | null;
  title?: string;
}

interface PatchResponse {
  item: OpsItem;
  previous: OpsFields;
  previousStatus: OpsItem["status"];
  previousDueDate: string | null;
}

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export function useOpsActions() {
  const queryClient = useQueryClient();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["operations"] });
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };

  const update = useMutation({
    mutationFn: async (args: { id: string; body: PatchBody; message: string }) =>
      (await send(`/api/operations/items/${args.id}`, "PATCH", args.body)) as PatchResponse,
    onSuccess: (result, args) => {
      refresh();
      toast.success(args.message, {
        action: {
          label: "Undo",
          onClick: () => {
            const body: PatchBody = { ops: restorePatch(result.previous) };
            if (args.body.status !== undefined) body.status = result.previousStatus;
            if (args.body.dueDate !== undefined) body.dueDate = result.previousDueDate;
            send(`/api/operations/items/${args.id}`, "PATCH", body)
              .then(refresh)
              .catch((e: Error) => toast.error(e.message));
          },
        },
      });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const create = useMutation({
    mutationFn: async (body: {
      title: string;
      projectId?: string | null;
      dueDate?: string | null;
      ops: OpsPatch;
    }) => (await send("/api/operations/items", "POST", body)) as { item: OpsItem },
    onSuccess: () => {
      refresh();
      toast.success("Added");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const setLane = useMutation({
    mutationFn: async (args: { projectId: string; laneState: string | null; name: string }) =>
      (await send(`/api/operations/portfolio/${args.projectId}`, "PATCH", {
        laneState: args.laneState,
      })) as { previous: string | null; next: string | null },
    onSuccess: (result, args) => {
      refresh();
      toast.success(
        args.laneState ? `${args.name} marked ${args.laneState}` : `${args.name} reset to its project status`,
        {
          action: {
            label: "Undo",
            onClick: () => {
              send(`/api/operations/portfolio/${args.projectId}`, "PATCH", {
                laneState: result.previous,
              })
                .then(refresh)
                .catch((e: Error) => toast.error(e.message));
            },
          },
        }
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const intake = useMutation({
    mutationFn: async (args: { id: string; body: Record<string, unknown>; message: string }) =>
      send(`/api/operations/intake/${args.id}`, "POST", args.body),
    onSuccess: (_result, args) => {
      refresh();
      toast.success(args.message, {
        action: {
          label: "Undo",
          onClick: () => {
            send(`/api/operations/intake/${args.id}`, "POST", { action: "reopen" })
              .then(refresh)
              .catch((e: Error) => toast.error(e.message));
          },
        },
      });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return { update, create, setLane, intake };
}
