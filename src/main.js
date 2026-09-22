import { createClient } from "@supabase/supabase-js";
import "./style.css";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

const app = document.getElementById("app");
const state = {
  view: "porch",
  session: null,
  profile: null,
  publicNotes: [],
  mine: [],
  pulse: [],
  notice: "",
};

function fmt(d) {
  try {
    return new Date(d).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function hourLabel() {
  const n = new Date();
  return n.toLocaleString(undefined, { weekday: "long", hour: "numeric" });
}

function setNotice(t) {
  state.notice = t;
  const el = document.querySelector(".msg");
  if (el) el.textContent = t;
}

async function ensureProfile(user, handle) {
  const { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (p) return p;
  const h = handle || user.user_metadata?.username || (user.email || "guest").split("@")[0].slice(0, 20);
  const row = { id: user.id, handle: h, display_name: h };
  const { data: created } = await supabase.from("profiles").insert(row).select().maybeSingle();
  return created || row;
}

async function refreshSession() {
  const { data } = await supabase.auth.getSession();
  state.session = data.session;
  if (state.session) state.profile = await ensureProfile(state.session.user);
  else state.profile = null;
}

async function loadPublic() {
  const { data } = await supabase
    .from("notes")
    .select("id,title,body,created_at,user_id,profiles(handle,display_name)")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(40);
  state.publicNotes = data || [];
}

async function loadMine() {
  if (!state.session) { state.mine = []; return; }
  const { data } = await supabase.from("notes").select("*").eq("user_id", state.session.user.id).order("created_at", { ascending: false });
  state.mine = data || [];
}

async function loadPulse() {
  const { data } = await supabase.from("feature_log").select("*").order("shipped_at", { ascending: false }).limit(12);
  state.pulse = data || [];
}

async function signUp(email, password, handle) {
  const { error } = await supabase.auth.signUp({
    email, password,
    options: { data: { username: handle, display_name: handle } },
  });
  if (error) throw error;
}

async function signIn(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

async function signOut() {
  await supabase.auth.signOut();
  state.session = null;
  state.profile = null;
  state.view = "porch";
}

async function publishNote({ title, body, is_public }) {
  if (!state.session) throw new Error("Sign in first.");
  const { error } = await supabase.from("notes").insert({
    user_id: state.session.user.id,
    title: title || "Untitled",
    body,
    is_public,
  });
  if (error) throw error;
}

function escapeHtml(s) {
  return String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function noteCard(n, i) {
  const name = n.profiles?.display_name || n.profiles?.handle || "someone on the porch";
  return `<article class="card" style="animation-delay:${i * 40}ms">
    <h3>${escapeHtml(n.title || "Untitled")}</h3>
    <div class="meta">${escapeHtml(name)} · ${fmt(n.created_at)}</div>
    <p>${escapeHtml(n.body || "")}</p>
  </article>`;
}

function mineCard(n, i) {
  return `<article class="card" style="animation-delay:${i * 40}ms">
    <h3>${escapeHtml(n.title || "Untitled")}</h3>
    <div class="meta">${n.is_public ? "On the rail" : "In the drawer"} · ${fmt(n.created_at)}</div>
    <p>${escapeHtml(n.body || "")}</p>
  </article>`;
}

function render() {
  const who = state.profile?.handle || state.session?.user?.email || "";
  app.innerHTML = `
    <header class="mast">
      <div class="mark">Slate Porch<small>Hourly living room</small></div>
      <nav class="nav">
        <button data-go="porch">The rail</button>
        <button data-go="pulse">This hour</button>
        ${state.session ? `<button data-go="desk">Your desk</button>` : `<button data-go="door">Come in</button>`}
        ${state.session ? `<button data-act="out">Leave</button>` : ""}
      </nav>
    </header>
    ${
      state.view === "porch"
        ? `
      <section class="hero">
        <div class="hour-chip"><i></i>${hourLabel()}</div>
        <h1>Leave a note on the rail.</h1>
        <p class="lede">This porch turns over every hour. What you mark public sits out here for anyone walking past. The rest stays in your drawer.</p>
      </section>
      <div class="layout">
        <div class="rail">
          <div class="section-label">Public notes</div>
          ${state.publicNotes.length ? state.publicNotes.map(noteCard).join("") : `<p class="empty">Quiet for now. Be the first to pin something.</p>`}
        </div>
        <aside class="desk">
          <div class="section-label">Latest pulse</div>
          ${state.pulse.slice(0, 5).map((p, i) => `<div class="pulse-item" style="animation-delay:${i * 50}ms">
              <time>${fmt(p.shipped_at)}</time>
              <h4>${escapeHtml(p.title)}</h4>
              <p>${escapeHtml(p.body)}</p>
            </div>`).join("") || `<p class="empty">The hour has not spoken yet.</p>`}
        </aside>
      </div>`
        : ""
    }
    ${
      state.view === "pulse"
        ? `
      <section class="hero">
        <div class="hour-chip"><i></i>Dispatch</div>
        <h1>What changed this hour.</h1>
        <p class="lede">A short log of the work that lands on the porch. Nothing flashy — just the next honest piece.</p>
      </section>
      <div class="layout">
        <div class="rail">
          ${state.pulse.map((p, i) => `<article class="card" style="animation-delay:${i * 40}ms">
              <div class="meta">${fmt(p.shipped_at)}</div>
              <h3>${escapeHtml(p.title)}</h3>
              <p>${escapeHtml(p.body)}</p>
            </article>`).join("") || `<p class="empty">Empty log.</p>`}
        </div>
        <aside></aside>
      </div>`
        : ""
    }
    ${
      state.view === "door"
        ? `
      <section class="hero">
        <h1>Come onto the porch.</h1>
        <p class="lede">Email and a password. Pick a short handle so the rail knows who left the note.</p>
      </section>
      <div class="layout">
        <form class="auth" id="auth-form">
          <input name="handle" placeholder="handle" maxlength="24" />
          <input name="email" type="email" required placeholder="email" />
          <input name="password" type="password" required placeholder="password" minlength="6" />
          <div class="row">
            <button class="solid" type="submit" data-mode="in">Sign in</button>
            <button class="ghost" type="submit" data-mode="up">Create a desk</button>
          </div>
          <div class="msg">${escapeHtml(state.notice)}</div>
        </form>
      </div>`
        : ""
    }
    ${
      state.view === "desk"
        ? `
      <section class="hero">
        <div class="hour-chip"><i></i>${who || "your desk"}</div>
        <h1>Write it down.</h1>
        <p class="lede">Private by default. Tick the box if it belongs on the rail.</p>
      </section>
      <div class="layout">
        <div>
          <form class="compose" id="compose">
            <input name="title" placeholder="A short title" maxlength="80" />
            <textarea name="body" required placeholder="What do you want to keep?"></textarea>
            <label class="check"><input type="checkbox" name="is_public" /> Put this on the public rail</label>
            <button class="solid" type="submit">Save</button>
            <div class="msg">${escapeHtml(state.notice)}</div>
          </form>
          <div class="section-label">Your drawer</div>
          ${state.mine.length ? state.mine.map(mineCard).join("") : `<p class="empty">Nothing in the drawer yet.</p>`}
        </div>
        <aside></aside>
      </div>`
        : ""
    }
    <footer>Slate Porch · saved in full · public only when you say so</footer>
  `;

  app.querySelectorAll("[data-go]").forEach((b) => {
    b.onclick = () => {
      state.view = b.dataset.go;
      if (state.view === "desk" && !state.session) state.view = "door";
      render();
    };
  });
  const out = app.querySelector("[data-act=out]");
  if (out) out.onclick = async () => { await signOut(); render(); };

  const auth = app.querySelector("#auth-form");
  if (auth) {
    let mode = "in";
    auth.querySelectorAll("[data-mode]").forEach((btn) => {
      btn.addEventListener("click", () => { mode = btn.dataset.mode; });
    });
    auth.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(auth);
      try {
        setNotice("Working…");
        if (mode === "up") {
          await signUp(fd.get("email"), fd.get("password"), fd.get("handle") || "guest");
          setNotice("Check your email if confirmation is on, then sign in.");
        } else {
          await signIn(fd.get("email"), fd.get("password"));
          await refreshSession();
          await loadMine();
          state.view = "desk";
          state.notice = "";
          render();
        }
      } catch (err) {
        setNotice(err.message || "Could not get you in.");
      }
    };
  }

  const compose = app.querySelector("#compose");
  if (compose) {
    compose.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(compose);
      try {
        setNotice("Saving…");
        await publishNote({
          title: fd.get("title"),
          body: fd.get("body"),
          is_public: fd.get("is_public") === "on",
        });
        compose.reset();
        await Promise.all([loadMine(), loadPublic()]);
        state.notice = "Saved.";
        render();
      } catch (err) {
        setNotice(err.message || "Could not save.");
      }
    };
  }
}

async function boot() {
  await refreshSession();
  await Promise.all([loadPublic(), loadMine(), loadPulse()]);
  supabase.auth.onAuthStateChange(async () => {
    await refreshSession();
    await loadMine();
    render();
  });
  render();
}

boot();
