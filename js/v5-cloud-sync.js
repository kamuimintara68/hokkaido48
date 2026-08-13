"use strict";

(function () {
  const SUPABASE_URL = "https://rlpverrmvpzupbnkwtse.supabase.co";
  const SUPABASE_KEY = "sb_publishable_GqQ4C2evdVKKev-Lq66KCg_Xkfi1-i0";
  const TABLE = "user_sync_data";
  const LOCAL_SYNCED_AT_KEY = "hokkaido48V5CloudSyncedAt";

  function client() {
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      throw new Error("クラウド接続ライブラリを読み込めませんでした。");
    }
    if (!window.Hokkaido48SupabaseClient) {
      window.Hokkaido48SupabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
    }
    return window.Hokkaido48SupabaseClient;
  }

  function isAppKey(key) {
    return String(key || "").startsWith("hokkaido48") && key !== LOCAL_SYNCED_AT_KEY;
  }

  function collectLocalData() {
    const storage = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (isAppKey(key)) storage[key] = localStorage.getItem(key);
    }
    return { schemaVersion: 1, exportedAt: new Date().toISOString(), storage };
  }

  function applyCloudData(payload) {
    if (!payload || typeof payload !== "object" || !payload.storage || typeof payload.storage !== "object") {
      throw new Error("クラウドデータの形式が正しくありません。");
    }
    Object.entries(payload.storage).forEach(([key, value]) => {
      if (!isAppKey(key) || typeof value !== "string") return;
      localStorage.setItem(key, value);
    });
  }

  async function currentUser() {
    const { data, error } = await client().auth.getUser();
    if (error && (error.name === "AuthSessionMissingError" || /session missing/i.test(String(error.message || "")))) return null;
    if (error) throw error;
    return data && data.user ? data.user : null;
  }

  async function signInWithEmail(email) {
    const address = String(email || "").trim();
    if (!address) throw new Error("メールアドレスを入力してください。");
    const { error } = await client().auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: window.location.href.split("#")[0].split("?")[0] }
    });
    if (error) throw error;
  }

  async function signOut() {
    const { error } = await client().auth.signOut();
    if (error) throw error;
  }

  async function upload() {
    const user = await currentUser();
    if (!user) throw new Error("先にログインしてください。");
    const now = new Date().toISOString();
    const { error } = await client().from(TABLE).upsert({
      user_id: user.id,
      payload: collectLocalData(),
      device_updated_at: now,
      updated_at: now
    }, { onConflict: "user_id" });
    if (error) throw error;
    localStorage.setItem(LOCAL_SYNCED_AT_KEY, now);
    return now;
  }

  async function download() {
    const user = await currentUser();
    if (!user) throw new Error("先にログインしてください。");
    const { data, error } = await client().from(TABLE)
      .select("payload, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("クラウドにはまだ保存データがありません。");
    applyCloudData(data.payload);
    localStorage.setItem(LOCAL_SYNCED_AT_KEY, data.updated_at || new Date().toISOString());
    return data.updated_at || "";
  }

  window.Hokkaido48CloudSync = {
    client, currentUser, signInWithEmail, signOut, upload, download, collectLocalData
  };
})();
