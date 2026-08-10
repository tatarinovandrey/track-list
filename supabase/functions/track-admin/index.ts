import { createClient } from "npm:@supabase/supabase-js@2";

const ADMIN_PASSWORD_HASH = "f3857f968603fa867f73802c9a133cda9e076cf69a3cf6df6177b1d5bcd1d0b5";
const allowedOrigins = new Set([
  "https://track-list.online",
  "https://www.track-list.online",
  "https://track-list.ru",
  "https://www.track-list.ru",
]);

function headers(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  const allowed = allowedOrigins.has(origin) || origin.endsWith(".vercel.app");
  return {
    "Access-Control-Allow-Origin": allowed ? origin : "null",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
  };
}

async function hash(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function response(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: headers(request) });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: headers(request) });
  if (request.method !== "POST") return response(request, { error: "Method not allowed" }, 405);

  try {
    const body = await request.json();
    if (typeof body.password !== "string" || await hash(body.password) !== ADMIN_PASSWORD_HASH) return response(request, { error: "Неверный пароль." }, 401);
    if (body.action === "verify") return response(request, { ok: true });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if (body.action === "create") {
      const title = String(body.title ?? "").trim();
      const lyrics = String(body.lyrics ?? "");
      if (!title) return response(request, { error: "Введите название трека." }, 400);
      const { data: lastTrack, error: lastError } = await supabase.from("tracks").select("position").order("position", { ascending: false }).limit(1).maybeSingle();
      if (lastError) throw lastError;
      const { error } = await supabase.from("tracks").insert({ title, lyrics, position: (lastTrack?.position ?? -1) + 1 });
      if (error) throw error;
      return response(request, { ok: true });
    }

    if (body.action === "update") {
      const title = String(body.title ?? "").trim();
      const lyrics = String(body.lyrics ?? "");
      if (!title || typeof body.id !== "string") return response(request, { error: "Проверьте название трека." }, 400);
      const { error } = await supabase.from("tracks").update({ title, lyrics, updated_at: new Date().toISOString() }).eq("id", body.id);
      if (error) throw error;
      return response(request, { ok: true });
    }

    if (body.action === "delete") {
      if (typeof body.id !== "string") return response(request, { error: "Invalid track." }, 400);
      const { error } = await supabase.from("tracks").delete().eq("id", body.id);
      if (error) throw error;
      return response(request, { ok: true });
    }

    if (body.action === "delete_all") {
      const { error } = await supabase.from("tracks").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) throw error;
      return response(request, { ok: true });
    }

    if (body.action === "reorder" && Array.isArray(body.order) && body.order.every((id: unknown) => typeof id === "string")) {
      for (let index = 0; index < body.order.length; index++) {
        const { error } = await supabase.from("tracks").update({ position: 100000 + index }).eq("id", body.order[index]);
        if (error) throw error;
      }
      for (let index = 0; index < body.order.length; index++) {
        const { error } = await supabase.from("tracks").update({ position: index, updated_at: new Date().toISOString() }).eq("id", body.order[index]);
        if (error) throw error;
      }
      return response(request, { ok: true });
    }
    return response(request, { error: "Неизвестное действие." }, 400);
  } catch (error) {
    console.error(error);
    return response(request, { error: "Не удалось сохранить изменения." }, 500);
  }
});
