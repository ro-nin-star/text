const API_BASE_URL = "https://text-uzenetfal.ro-nin-star.workers.dev";

const state = {
  token: sessionStorage.getItem("adminToken") || null,
};

const els = {
  adminToggleBtn: document.getElementById("admin-toggle-btn"),
  adminPanel: document.getElementById("admin-panel"),
  loginForm: document.getElementById("login-form"),
  adminPassword: document.getElementById("admin-password"),
  adminLogoutBtn: document.getElementById("admin-logout-btn"),
  loginError: document.getElementById("login-error"),
  messageForm: document.getElementById("message-form"),
  authorInput: document.getElementById("author-input"),
  textInput: document.getElementById("text-input"),
  submitError: document.getElementById("submit-error"),
  refreshBtn: document.getElementById("refresh-btn"),
  messageList: document.getElementById("message-list"),
  loadingText: document.getElementById("loading-text"),
};

function isAdmin() {
  return Boolean(state.token);
}

function setAdminUiState() {
  els.adminPanel.classList.remove("hidden");
  els.loginForm.classList.toggle("hidden", isAdmin());
  els.adminLogoutBtn.classList.toggle("hidden", !isAdmin());
}

function formatDate(iso) {
  return new Date(iso).toLocaleString("hu-HU");
}

function showError(el, message) {
  el.textContent = message;
  el.classList.toggle("hidden", !message);
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((data && data.error) || `Hiba történt (${res.status}).`);
  }
  return data;
}

function renderReply(reply) {
  const div = document.createElement("div");
  div.className = "reply";
  div.innerHTML = `
    <div class="message-meta">
      <span class="message-author">${escapeHtml(reply.author)}</span>
      <span>${formatDate(reply.createdAt)}</span>
    </div>
    <p class="message-text">${escapeHtml(reply.text)}</p>
  `;
  return div;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderMessage(message) {
  const card = document.createElement("article");
  card.className = `message-card${message.state === "closed" ? " closed" : ""}`;

  card.innerHTML = `
    <div class="message-meta">
      <span class="message-author">${escapeHtml(message.author)}</span>
      <span>${formatDate(message.createdAt)}${message.state === "closed" ? " · elrejtve" : ""}</span>
    </div>
    <p class="message-text">${escapeHtml(message.text)}</p>
  `;

  (message.replies || []).forEach((reply) => {
    card.appendChild(renderReply(reply));
  });

  if (isAdmin()) {
    const actions = document.createElement("div");
    actions.className = "admin-actions";

    const replyBtn = document.createElement("button");
    replyBtn.type = "button";
    replyBtn.textContent = "Válasz";
    replyBtn.addEventListener("click", () => toggleReplyForm(card, message.id));
    actions.appendChild(replyBtn);

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.textContent = message.state === "closed" ? "Visszaállítás" : "Elrejtés";
    toggleBtn.addEventListener("click", () => handleToggleHide(message.id, message.state));
    actions.appendChild(toggleBtn);

    card.appendChild(actions);
  }

  return card;
}

function toggleReplyForm(card, issueId) {
  const existing = card.querySelector(".reply-form");
  if (existing) {
    existing.remove();
    return;
  }
  const form = document.createElement("form");
  form.className = "reply-form";
  form.innerHTML = `
    <textarea placeholder="Válasz mint ronin..." maxlength="1000" required></textarea>
    <button type="submit">Válasz küldése</button>
  `;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const textarea = form.querySelector("textarea");
    try {
      await apiFetch("/api/admin/reply", {
        method: "POST",
        headers: { Authorization: `Bearer ${state.token}` },
        body: JSON.stringify({ issueId, text: textarea.value }),
      });
      await loadMessages();
    } catch (err) {
      alert(err.message);
    }
  });
  card.appendChild(form);
}

async function handleToggleHide(issueId, currentState) {
  const path = currentState === "closed" ? "/api/admin/unhide" : "/api/admin/hide";
  try {
    await apiFetch(path, {
      method: "POST",
      headers: { Authorization: `Bearer ${state.token}` },
      body: JSON.stringify({ issueId }),
    });
    await loadMessages();
  } catch (err) {
    alert(err.message);
  }
}

async function loadMessages() {
  els.loadingText.classList.remove("hidden");
  try {
    const messages = isAdmin()
      ? await apiFetch("/api/admin/messages", {
          method: "POST",
          headers: { Authorization: `Bearer ${state.token}` },
        })
      : await apiFetch("/api/messages");

    els.messageList.innerHTML = "";
    if (messages.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-text";
      empty.textContent = "Még nincs egyetlen üzenet sem.";
      els.messageList.appendChild(empty);
      return;
    }
    messages.forEach((message) => els.messageList.appendChild(renderMessage(message)));
  } catch (err) {
    els.messageList.innerHTML = "";
    const errorEl = document.createElement("p");
    errorEl.className = "error";
    errorEl.textContent = err.message;
    els.messageList.appendChild(errorEl);
  } finally {
    els.loadingText.classList.add("hidden");
  }
}

els.adminToggleBtn.addEventListener("click", () => {
  els.adminPanel.classList.toggle("hidden");
  setAdminUiState();
});

els.loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  showError(els.loginError, "");
  try {
    const { token } = await apiFetch("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password: els.adminPassword.value }),
    });
    state.token = token;
    sessionStorage.setItem("adminToken", token);
    els.adminPassword.value = "";
    setAdminUiState();
    await loadMessages();
  } catch (err) {
    showError(els.loginError, err.message);
  }
});

els.adminLogoutBtn.addEventListener("click", () => {
  state.token = null;
  sessionStorage.removeItem("adminToken");
  setAdminUiState();
  loadMessages();
});

els.messageForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  showError(els.submitError, "");
  try {
    await apiFetch("/api/messages", {
      method: "POST",
      body: JSON.stringify({ author: els.authorInput.value, text: els.textInput.value }),
    });
    els.authorInput.value = "";
    els.textInput.value = "";
    await loadMessages();
  } catch (err) {
    showError(els.submitError, err.message);
  }
});

els.refreshBtn.addEventListener("click", loadMessages);

setAdminUiState();
els.adminPanel.classList.add("hidden");
loadMessages();
