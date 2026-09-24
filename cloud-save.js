(() => {
  "use strict";

  const CONFIG = Object.freeze({
    owner: "doo-doo-lab",
    repo: "mygame",
    branch: "save",
    path: "save/main.save",
    tokenKey: "dol.github-sync.token.v1",
    apiBase: "https://api.github.com",
    apiVersion: "2022-11-28",
  });

  const state = {
    token: null,
    ready: false,
    loading: false,
    collecting: false,
    uploading: false,
    uploadTimer: null,
    remoteSha: null,
    saveHandler: null,
  };

  const GAME_API_WAIT_MS = 60_000;
  const GAME_API_POLL_MS = 100;

  const $ = (selector) => document.querySelector(selector);

  function setStatus(message, tone = "info") {
    const badge = $("#dol-cloud-status");
    if (!badge) return;
    badge.textContent = message;
    badge.dataset.tone = tone;
  }

  function makeStatusBadge() {
    if ($("#dol-cloud-status")) return;
    const style = document.createElement("style");
    style.textContent = `
      #dol-cloud-status {
        position: fixed;
        z-index: 2147483646;
        right: 12px;
        bottom: 12px;
        max-width: min(360px, calc(100vw - 24px));
        padding: 7px 10px;
        border: 1px solid rgba(255,255,255,.28);
        border-radius: 7px;
        color: #fff;
        background: rgba(22, 27, 34, .9);
        box-shadow: 0 2px 12px rgba(0,0,0,.35);
        font: 13px/1.35 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        cursor: pointer;
      }
      #dol-cloud-status[data-tone="ok"] { background: rgba(25, 102, 64, .94); }
      #dol-cloud-status[data-tone="warn"] { background: rgba(135, 91, 19, .96); }
      #dol-cloud-status[data-tone="error"] { background: rgba(133, 35, 35, .96); }
      #dol-cloud-status:focus { outline: 2px solid #7db7ff; outline-offset: 2px; }
      #dol-cloud-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483645;
        display: grid;
        place-items: center;
        padding: 20px;
        background: rgba(8, 10, 14, .72);
        color: #fff;
        font: 15px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #dol-cloud-card {
        width: min(440px, 100%);
        padding: 22px;
        border: 1px solid rgba(255,255,255,.22);
        border-radius: 12px;
        background: #1d232d;
        box-shadow: 0 12px 42px rgba(0,0,0,.45);
      }
      #dol-cloud-card h2 { margin: 0 0 9px; font-size: 19px; }
      #dol-cloud-card p { margin: 8px 0; }
      #dol-cloud-card a { color: #9bc7ff; }
      #dol-cloud-token {
        box-sizing: border-box;
        width: 100%;
        margin: 10px 0;
        padding: 10px;
        border: 1px solid #697586;
        border-radius: 6px;
        color: #fff;
        background: #11161d;
        font: 14px ui-monospace, SFMono-Regular, Consolas, monospace;
      }
      #dol-cloud-connect {
        padding: 9px 13px;
        border: 0;
        border-radius: 6px;
        color: #fff;
        background: #2878d1;
        font-weight: 600;
        cursor: pointer;
      }
      #dol-cloud-connect:disabled { opacity: .6; cursor: wait; }
      #dol-cloud-error { min-height: 1.5em; color: #ffb4b4; }
    `;
    document.head.appendChild(style);

    const badge = document.createElement("button");
    badge.id = "dol-cloud-status";
    badge.type = "button";
    badge.textContent = "云端存档：准备中";
    badge.title = "点击立即同步当前存档";
    badge.addEventListener("click", () => {
      if (state.ready) void uploadCurrent();
    });
    document.body.appendChild(badge);
  }

  function showTokenPanel(message = "首次使用需要设置同步令牌。令牌只保存在此浏览器。") {
    if ($("#dol-cloud-overlay")) return;
    const overlay = document.createElement("div");
    overlay.id = "dol-cloud-overlay";
    overlay.innerHTML = `
      <section id="dol-cloud-card" role="dialog" aria-labelledby="dol-cloud-title">
        <h2 id="dol-cloud-title">连接云端存档</h2>
        <p>${message}</p>
        <p>请创建一个只允许访问 <code>doo-doo-lab/mygame</code>、具有 <code>Contents: Read and write</code> 权限的细粒度令牌。</p>
        <p><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">打开 GitHub 令牌设置</a></p>
        <input id="dol-cloud-token" type="password" autocomplete="off" spellcheck="false" placeholder="粘贴 github_pat_... 令牌">
        <div id="dol-cloud-error" role="status"></div>
        <button id="dol-cloud-connect" type="button">连接并读取存档</button>
      </section>
    `;
    document.body.appendChild(overlay);
    const input = $("#dol-cloud-token");
    const button = $("#dol-cloud-connect");
    const error = $("#dol-cloud-error");
    const submit = async () => {
      const token = input.value.trim();
      if (!token) {
        error.textContent = "请输入令牌。";
        input.focus();
        return;
      }
      button.disabled = true;
      error.textContent = "正在验证令牌并读取存档……";
      try {
        state.token = token;
        const remote = await getRemoteSave();
        localStorage.setItem(CONFIG.tokenKey, token);
        overlay.remove();
        await finishBoot(remote);
      } catch (e) {
        state.token = null;
        button.disabled = false;
        error.textContent = formatError(e);
      }
    };
    button.addEventListener("click", () => void submit());
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") void submit();
    });
    input.focus();
  }

  function formatError(error) {
    const message = String(error?.message ?? error ?? "");
    if (error && error.status === 401) return "令牌无效、已过期或已被撤销，请重新创建。";
    if (error && error.status === 403 && /rate limit/i.test(message)) {
      return "GitHub API 暂时限流，请稍后再试或更换网络。";
    }
    if (error && error.status === 403) return "令牌没有此仓库的 Contents 写入权限。";
    if (error && error.status === 404) return "找不到存档分支或文件，请确认仓库已完成初始化。";
    if (/failed to fetch/i.test(message)) {
      return "无法访问 GitHub API，请检查 VPN、网络或浏览器拦截后重试。";
    }
    if (/loadfailed/i.test(message)) {
      return "游戏加载存档失败：请先刷新页面，等待资源加载完成后再连接云端。";
    }
    return `同步失败：${message || error}`;
  }

  function apiHeaders() {
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": CONFIG.apiVersion,
      "Cache-Control": "no-cache",
    };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    return headers;
  }

  function saveUrl() {
    const path = CONFIG.path.split("/").map(encodeURIComponent).join("/");
    return `${CONFIG.apiBase}/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${path}?ref=${encodeURIComponent(CONFIG.branch)}`;
  }

  function decodeBase64Utf8(value) {
    const binary = atob(value.replace(/\s/g, ""));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function encodeBase64Utf8(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  async function getRemoteSave() {
    const response = await fetch(saveUrl(), { headers: apiHeaders(), cache: "no-store" });
    if (response.status === 404) return null;
    if (!response.ok) {
      let message = `GitHub API ${response.status}`;
      try {
        const payload = await response.json();
        if (payload?.message) message += `: ${payload.message}`;
      } catch {
        // Keep the HTTP status when GitHub does not return JSON.
      }
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    const payload = await response.json();
    return {
      data: decodeBase64Utf8(payload.content || ""),
      sha: payload.sha || null,
    };
  }

  async function putRemoteSave(data, sha) {
    const body = {
      message: `sync: save ${new Date().toISOString()}`,
      content: encodeBase64Utf8(data),
      branch: CONFIG.branch,
    };
    if (sha) body.sha = sha;
    const response = await fetch(saveUrl(), {
      method: "PUT",
      headers: { ...apiHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      let message = `GitHub API ${response.status}`;
      try {
        const payload = await response.json();
        if (payload?.message) message += `: ${payload.message}`;
      } catch {
        // Keep the HTTP status when GitHub does not return JSON.
      }
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    const payload = await response.json();
    return payload.content?.sha || null;
  }

  async function waitForGameApi() {
    const deadline = Date.now() + GAME_API_WAIT_MS;
    while (Date.now() < deadline) {
      if (
        window.SugarCube?.Save
        && typeof window.DeserializeGame === "function"
        && typeof window.SerializeGame === "function"
      ) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, GAME_API_POLL_MS));
    }
    throw new Error("游戏资源加载未完成，请刷新页面后重试");
  }

  async function finishBoot(remote) {
    await waitForGameApi();
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (remote?.data) {
      state.collecting = true;
      try {
        const result = window.DeserializeGame(remote.data);
        if (result === null) throw new Error("云端存档无法被当前游戏版本读取");
      } finally {
        state.collecting = false;
      }
      state.remoteSha = remote.sha;
      setStatus("云端存档：已读取", "ok");
    } else {
      setStatus("云端存档：暂无文件", "warn");
    }
    state.ready = true;
    state.saveHandler = () => {
      if (!state.collecting) scheduleUpload();
    };
    window.SugarCube?.Save?.onSave?.add(state.saveHandler);
    if (remote?.data) scheduleUpload();
  }

  function scheduleUpload() {
    if (!state.ready) return;
    clearTimeout(state.uploadTimer);
    state.uploadTimer = setTimeout(() => void uploadCurrent(), 1200);
  }

  async function uploadCurrent() {
    if (!state.ready || state.uploading || typeof window.SerializeGame !== "function") return;
    state.uploading = true;
    clearTimeout(state.uploadTimer);
    setStatus("云端存档：同步中…", "info");
    try {
      state.collecting = true;
      const data = window.SerializeGame();
      state.collecting = false;
      if (typeof data !== "string" || !data) throw new Error("游戏没有返回有效存档");
      const remote = await getRemoteSave();
      if (remote?.data === data) {
        state.remoteSha = remote.sha;
        setStatus("云端存档：已同步", "ok");
        return;
      }
      state.remoteSha = await putRemoteSave(data, remote?.sha || null);
      setStatus("云端存档：已同步", "ok");
    } catch (e) {
      state.collecting = false;
      setStatus(formatError(e), "error");
      console.error("[DoL cloud save]", e);
    } finally {
      state.uploading = false;
    }
  }

  async function boot() {
    makeStatusBadge();
    state.token = localStorage.getItem(CONFIG.tokenKey);
    if (!state.token) {
      setStatus("云端存档：需要令牌", "warn");
      showTokenPanel();
      return;
    }
    state.loading = true;
    setStatus("云端存档：读取中…", "info");
    try {
      const remote = await getRemoteSave();
      await finishBoot(remote);
    } catch (e) {
      state.token = null;
      localStorage.removeItem(CONFIG.tokenKey);
      setStatus("云端存档：需要重新连接", "warn");
      showTokenPanel(formatError(e));
    } finally {
      state.loading = false;
    }
  }

  let started = false;

  function startOnce() {
    if (started) return;
    started = true;
    void boot();
  }

  function waitForStoryReady() {
    if (window.SugarCube?.Save && typeof window.DeserializeGame === "function") {
      startOnce();
      return;
    }
    if (window.jQuery) {
      window.jQuery(document).one(":storyready", startOnce);
    }
    window.addEventListener("load", () => {
      if (window.SugarCube?.Save && typeof window.DeserializeGame === "function") startOnce();
    }, { once: true });
  }

  // The game's :storyready event can occur before DOMContentLoaded, so register
  // the listener immediately while the script is still at the end of <body>.
  waitForStoryReady();
})();
