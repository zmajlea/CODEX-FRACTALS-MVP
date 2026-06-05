"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";

type InboxItem = {
  id: string;
  title_plain: string;
  deep_link: string | null;
  read_at: string | null;
  item_type: string;
};

type InboxPanelProps = {
  isOpen: boolean;
  onClose: () => void;
};

export default function InboxPanel({ isOpen, onClose }: InboxPanelProps) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [items, setItems] = useState<InboxItem[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .from("inbox_items")
        .select("id, title_plain, deep_link, read_at, item_type")
        .eq("user_id", user.id)
        .is("read_at", null)
        .order("created_at", { ascending: false });
      setItems(data ?? []);
    })();
  }, [isOpen, supabase]);

  const handleOpen = async (item: InboxItem) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from("inbox_items")
      .update({ read_at: new Date().toISOString() })
      .eq("id", item.id);
    if (item.deep_link) router.push(item.deep_link);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <button
        type="button"
        className="flex-1 bg-obsidian/20 backdrop-blur-[2px]"
        onClick={onClose}
        aria-label="Close inbox"
      />
      <aside className="w-full max-w-md bg-vellum border-l border-bone h-full pt-16 flex flex-col shadow-xl">
        <div className="px-6 py-4 border-b border-bone flex justify-between items-center">
          <h2 className="font-head text-lg text-obsidian">Inbox</h2>
          <button
            type="button"
            onClick={onClose}
            className="font-data text-[10px] uppercase tracking-widest text-obsidian/50 hover:text-obsidian"
          >
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {items.length === 0 ? (
            <p className="font-data text-xs text-obsidian/40 uppercase tracking-widest text-center py-8">
              No unread notifications
            </p>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleOpen(item)}
                className="w-full text-left border border-bone px-4 py-3 mb-2 font-data text-xs hover:bg-bone/10"
              >
                <span className="uppercase text-[9px] text-obsidian/40 block mb-1">
                  {item.item_type}
                </span>
                {item.title_plain}
              </button>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
