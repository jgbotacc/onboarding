(function () {
  "use strict";
  var API_BASE = "";
  var MAX_ROUNDS = 3;
  var STATUS_LABELS = {
    registering: "Registering", missing_info: "Missing info", generating: "Generating",
    awaiting_review: "Awaiting review", accepted: "Accepted", handed_off: "Handed off"
  };

  var $ = function (id) { return document.getElementById(id); };
  var chat = $("chat"), form = $("composer"), input = $("textInput"), fileInput = $("fileInput");
  var chipsEl = $("chips"), sendBtn = $("sendBtn"), pill = $("statusPill");
  var missingCard = $("missingCard"), missingList = $("missingList");
  var lightbox = $("lightbox"), lightboxImg = $("lightboxImg"), overlay = $("dropOverlay");

  var state = { sessionId: null, mock: false, files: [], busy: false, feedbackMode: false, status: "registering" };

  /* ---------- Mock backend ---------- */
  function placeholderSvg(round, i) {
    var hues = [215, 160, 30, 280, 350];
    var h = hues[(round * 3 + i) % hues.length];
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(' + h + ',70%,88%)"/>' +
      '<stop offset="1" stop-color="hsl(' + h + ',70%,62%)"/></linearGradient></defs>' +
      '<rect width="512" height="512" fill="url(#g)"/>' +
      '<text x="256" y="240" font-family="Arial,sans-serif" font-size="44" font-weight="bold" text-anchor="middle" fill="#1f2937">Placeholder</text>' +
      '<text x="256" y="295" font-family="Arial,sans-serif" font-size="26" text-anchor="middle" fill="#374151">Round ' + round + ' · Option ' + (i + 1) + '</text></svg>';
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }
  function mockImages(round) { return [0, 1, 2].map(function (i) { return placeholderSvg(round, i); }); }

  var mockState = { registered: false, missing: [], round: 0, status: "registering" };
  function mockResp(reply, extra) {
    var r = { reply: reply, images: [], status: mockState.status, missing: mockState.missing.slice(), round: mockState.round };
    for (var k in extra) r[k] = extra[k];
    return r;
  }
  function mockGenerate(prefix) {
    mockState.round += 1;
    mockState.status = "awaiting_review";
    return mockResp(prefix + "Here are round " + mockState.round + " concepts based on your design direction. Do they look right?",
      { images: mockImages(mockState.round) });
  }
  var mock = {
    session: function () { return { sessionId: "mock-" + Math.random().toString(36).slice(2, 10) }; },
    upload: function (files) {
      var pdfs = files.filter(function (f) { return /\.pdf$/i.test(f.name); });
      var jpgs = files.length - pdfs.length;
      if (!mockState.registered && pdfs.length === 0) {
        return mockResp("Thanks for the " + jpgs + " reference image(s). Please also upload the PDF with your business details so I can register you.");
      }
      if (!mockState.registered) {
        mockState.registered = true;
        mockState.missing = ["Contact email or phone"];
        mockState.status = "missing_info";
        return mockResp("I've read your document and registered your business" + (jpgs ? " along with " + jpgs + " reference image(s)" : "") +
          ". One mandatory detail is missing: please send your contact email or phone number.");
      }
      return mockResp("Got " + files.length + " more file(s). I'll use them in the next round.");
    },
    chat: function (text) {
      if (!mockState.registered) return mockResp("Hi! To get started, please upload a PDF with your business details, plus any JPG reference images.");
      if (mockState.status === "missing_info") {
        if (/@|\d{6,}/.test(text.replace(/[\s+-]/g, "")) || /@/.test(text)) {
          mockState.missing = [];
          mockState.status = "generating";
          return mockGenerate("Thanks, your contact details are saved. ");
        }
        return mockResp("That doesn't look like an email or phone number. Could you send your contact email or phone?");
      }
      if (mockState.status === "awaiting_review") return mockResp("Please use \u201cLooks good\u201d or \u201cRequest changes\u201d on the images above.");
      if (mockState.status === "accepted") return mockResp("Your designs are approved. Our team will follow up with the final files.");
      if (mockState.status === "handed_off") return mockResp("A member of our team has your details and will be in touch shortly.");
      return mockResp("Noted.");
    },
    review: function (accepted, feedback) {
      if (accepted) {
        mockState.status = "accepted";
        return mockResp("Great, your design direction is approved! Your onboarding is complete and the team will prepare your final marketing materials.");
      }
      if (mockState.round >= MAX_ROUNDS) {
        mockState.status = "handed_off";
        return mockResp("Thanks for the feedback. We've done " + MAX_ROUNDS + " rounds, so I'm handing you over to a member of our team, who will take it from here.");
      }
      return mockGenerate("Thanks, I've applied your feedback" + (feedback ? " (\u201c" + feedback + "\u201d)" : "") + ". ");
    }
  };
  function mockCall(fn, args) {
    return new Promise(function (res) { setTimeout(function () { res(mock[fn].apply(null, args)); }, 600); });
  }

  /* ---------- API ---------- */
  function postJson(path, body) {
    return fetch(API_BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) })
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  }
  var api = {
    upload: function (files) {
      if (state.mock) return mockCall("upload", [files]);
      var fd = new FormData();
      fd.append("sessionId", state.sessionId);
      files.forEach(function (f) { fd.append("files[]", f, f.name); });
      return fetch(API_BASE + "/api/upload", { method: "POST", body: fd })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
    },
    chat: function (text) {
      return state.mock ? mockCall("chat", [text]) : postJson("/api/chat", { sessionId: state.sessionId, text: text });
    },
    review: function (accepted, feedback) {
      return state.mock ? mockCall("review", [accepted, feedback]) :
        postJson("/api/review", { sessionId: state.sessionId, accepted: accepted, feedback: feedback || "" });
    }
  };

  /* ---------- Rendering ---------- */
  function scrollDown() { chat.scrollTop = chat.scrollHeight; }
  function addMsg(role, text, fileNames) {
    var el = document.createElement("div");
    el.className = "msg " + role;
    if (text) el.appendChild(document.createTextNode(text));
    if (fileNames && fileNames.length) {
      var f = document.createElement("div");
      f.className = "files";
      f.textContent = "\uD83D\uDCCE " + fileNames.join(", ");
      el.appendChild(f);
    }
    chat.appendChild(el); scrollDown();
    return el;
  }
  function setStatus(s) {
    if (!s) return;
    state.status = s;
    pill.dataset.status = s;
    pill.textContent = STATUS_LABELS[s] || s.replace(/_/g, " ");
  }
  function setMissing(list) {
    missingList.innerHTML = "";
    (list || []).forEach(function (m) { var li = document.createElement("li"); li.textContent = m; missingList.appendChild(li); });
    missingCard.hidden = !(list && list.length);
  }
  function disableOldReviews() {
    chat.querySelectorAll(".review .btn").forEach(function (b) { b.disabled = true; });
  }
  function renderResponse(r) {
    r = r || {};
    var el = addMsg("assistant", r.reply || "");
    if (r.images && r.images.length) {
      var grid = document.createElement("div");
      grid.className = "img-grid";
      r.images.forEach(function (src, i) {
        var img = document.createElement("img");
        img.src = src; img.alt = "Generated image " + (i + 1); img.loading = "lazy";
        img.addEventListener("click", function () { lightboxImg.src = src; lightbox.hidden = false; });
        grid.appendChild(img);
      });
      el.appendChild(grid);
    }
    if (r.status === "awaiting_review") {
      disableOldReviews();
      if (r.round) {
        var rd = document.createElement("div");
        rd.className = "round"; rd.textContent = "Round " + r.round + " of " + MAX_ROUNDS;
        el.appendChild(rd);
      }
      var box = document.createElement("div");
      box.className = "review";
      var ok = document.createElement("button");
      ok.type = "button"; ok.className = "btn primary"; ok.textContent = "Looks good";
      var change = document.createElement("button");
      change.type = "button"; change.className = "btn"; change.textContent = "Request changes";
      ok.addEventListener("click", function () {
        if (state.busy) return;
        setFeedbackMode(false);
        addMsg("user", "Looks good");
        run(api.review(true, ""));
      });
      change.addEventListener("click", function () { setFeedbackMode(true); });
      box.appendChild(ok); box.appendChild(change);
      el.appendChild(box);
    } else if (r.status) {
      disableOldReviews();
    }
    setStatus(r.status);
    setMissing(r.missing);
    scrollDown();
  }
  function setFeedbackMode(on) {
    state.feedbackMode = on;
    form.classList.toggle("feedback", on);
    input.placeholder = on ? "Describe what you'd like changed…" : "Type a message…";
    if (on) input.focus();
  }
  var typingEl = null;
  function setBusy(b) {
    state.busy = b; sendBtn.disabled = b;
    if (b && !typingEl) {
      typingEl = document.createElement("div");
      typingEl.className = "typing"; typingEl.setAttribute("aria-label", "Waiting for reply");
      typingEl.innerHTML = "<span></span><span></span><span></span>";
      chat.appendChild(typingEl); scrollDown();
    } else if (!b && typingEl) { typingEl.remove(); typingEl = null; }
  }
  function run(p) {
    setBusy(true);
    return p.then(function (r) { setBusy(false); renderResponse(r); })
      .catch(function (e) { setBusy(false); addMsg("error", "Something went wrong (" + e.message + "). Please try again."); });
  }

  /* ---------- Files ---------- */
  function acceptable(f) { return /\.(pdf|jpe?g)$/i.test(f.name) || f.type === "application/pdf" || f.type === "image/jpeg"; }
  function addFiles(list) {
    var rejected = [];
    Array.prototype.forEach.call(list, function (f) { if (acceptable(f)) state.files.push(f); else rejected.push(f.name); });
    if (rejected.length) addMsg("error", "Only PDF and JPG files are supported: " + rejected.join(", "));
    renderChips();
  }
  function renderChips() {
    chipsEl.innerHTML = "";
    state.files.forEach(function (f, i) {
      var c = document.createElement("span"); c.className = "chip";
      var n = document.createElement("span"); n.className = "name";
      n.textContent = (/\.pdf$/i.test(f.name) ? "\uD83D\uDCC4 " : "\uD83D\uDDBC\uFE0F ") + f.name;
      var x = document.createElement("button"); x.type = "button"; x.textContent = "\u00D7"; x.setAttribute("aria-label", "Remove " + f.name);
      x.addEventListener("click", function () { state.files.splice(i, 1); renderChips(); });
      c.appendChild(n); c.appendChild(x); chipsEl.appendChild(c);
    });
  }

  /* ---------- Send ---------- */
  function send() {
    if (state.busy) return;
    var text = input.value.trim();
    var files = state.files.slice();
    if (!text && !files.length) return;
    input.value = ""; autosize();
    state.files = []; renderChips();
    addMsg("user", text, files.map(function (f) { return f.name; }));
    var chain;
    if (files.length) {
      chain = api.upload(files);
      if (text) {
        // render the upload reply, then send the text
        setBusy(true);
        chain = chain.then(function (r) { setBusy(false); renderResponse(r); return sendText(text, true); });
        return chain.catch(function (e) { setBusy(false); addMsg("error", "Something went wrong (" + e.message + "). Please try again."); });
      }
      return run(chain);
    }
    return sendText(text);
  }
  function sendText(text) {
    if (state.feedbackMode && state.status === "awaiting_review") {
      setFeedbackMode(false);
      return run(api.review(false, text));
    }
    setFeedbackMode(false);
    return run(api.chat(text));
  }

  /* ---------- Events ---------- */
  function autosize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 140) + "px"; }
  form.addEventListener("submit", function (e) { e.preventDefault(); send(); });
  input.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
  input.addEventListener("input", autosize);
  $("attachBtn").addEventListener("click", function () { fileInput.click(); });
  fileInput.addEventListener("change", function () { addFiles(fileInput.files); fileInput.value = ""; });
  lightbox.addEventListener("click", function () { lightbox.hidden = true; lightboxImg.src = ""; });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") lightbox.hidden = true; });
  var dragDepth = 0;
  var app = $("app");
  app.addEventListener("dragenter", function (e) { e.preventDefault(); dragDepth++; overlay.hidden = false; });
  app.addEventListener("dragover", function (e) { e.preventDefault(); });
  app.addEventListener("dragleave", function () { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) overlay.hidden = true; });
  app.addEventListener("drop", function (e) {
    e.preventDefault(); dragDepth = 0; overlay.hidden = true;
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });

  /* ---------- Init ---------- */
  function enableMock() {
    state.mock = true;
    $("demoBadge").hidden = false;
    state.sessionId = mock.session().sessionId;
  }
  var GREETING = "Welcome! Upload a PDF with your business details and any JPG reference images, and I'll get you set up.";
  function init() {
    var forceMock = /(^|[?&])mock=1(&|$)/.test(location.search);
    if (forceMock) { enableMock(); start(); return; }
    var saved = null;
    try { saved = sessionStorage.getItem("onboardingSessionId"); } catch (e) {}
    postJson("/api/session", saved ? { sessionId: saved } : {})
      .then(function (r) {
        if (!r || !r.sessionId) throw new Error("no sessionId");
        state.sessionId = r.sessionId;
        try { sessionStorage.setItem("onboardingSessionId", r.sessionId); } catch (e) {}
        start();
      })
      .catch(function () { enableMock(); start(); });
  }
  function start() { setStatus("registering"); addMsg("assistant", GREETING); input.focus(); }
  window.__onboarding = { state: state };
  init();
})();
