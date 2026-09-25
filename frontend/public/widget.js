/*
 * YOPEY Befriender — embeddable chat widget loader.
 *
 * A partner site adds ONE line and gets a floating chat bubble that opens the
 * full YOPEY funnel (onboarding -> care-home search -> email drafting) in an
 * iframe served from YOPEY's own origin:
 *
 *   <script src="https://app.yopeybefriender.org/widget.js" async></script>
 *
 * Optional <script> data- attributes:
 *   data-yopey-position="left|right"   (default right)
 *   data-yopey-label="Line 1|• Line 2" (launcher text; "|" or newline = new line.
 *                                        Defaults to the multi-line YOPEY copy,
 *                                        or training copy when entry is /training)
 *   data-yopey-color="#FFAD00"          (launcher + title-bar colour)
 *   data-yopey-entry="/onboard?embed=1" (iframe start path; /training for the
 *                                        training bubble; /chat to let returning
 *                                        users resume)
 *
 * Because the iframe runs on YOPEY's origin, all API calls inside it are
 * same-origin to the backend's allow-list — the host site needs no CORS or
 * other server changes. The host's CSS/JS cannot reach into the iframe.
 */
(function () {
  "use strict";

  // Idempotent: tolerate the snippet being pasted more than once on a page.
  if (window.__yopeyWidgetLoaded) return;
  window.__yopeyWidgetLoaded = true;

  // Never render inside another frame (e.g. our own embed iframe, where the
  // app already shows the chat) — prevents a widget-in-widget.
  try {
    if (window.self !== window.top) return;
  } catch (e) {
    return;
  }

  var script =
    document.currentScript ||
    (function () {
      var all = document.getElementsByTagName("script");
      return all[all.length - 1];
    })();

  // Derive YOPEY's origin from this script's own URL so the host needs no
  // config beyond the <script src>.
  var origin;
  try {
    origin = new URL(script.src).origin;
  } catch (e) {
    origin = window.location.origin;
  }

  var ds = (script && script.dataset) || {};
  var accent = ds.yopeyColor || "#FFAD00";
  var side = ds.yopeyPosition === "left" ? "left" : "right";
  var entry = ds.yopeyEntry || "/onboard?embed=1";
  var iframeUrl = origin + (entry.charAt(0) === "/" ? entry : "/" + entry);

  // The launcher is a small multi-line "bubble". Default copy advertises what
  // the AI does; a training embed (data-yopey-entry="/training") gets its own.
  // An explicit data-yopey-label still overrides (split on "|" or newlines).
  var MAIN_LABEL = [
    "Use YOPEY’s AI to",
    "• Find a care home to visit",
    "• Get befriending advice",
    "• Write better reports",
  ];
  var TRAINING_LABEL = ["Learn more about", "dementia and aging", "from YOPEY’s AI"];
  var labelLines;
  if (ds.yopeyLabel) {
    labelLines = ds.yopeyLabel
      .split(/\||\n/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length; });
  } else if (entry.indexOf("/training") === 0) {
    labelLines = TRAINING_LABEL;
  } else {
    labelLines = MAIN_LABEL;
  }
  var labelText = labelLines.join(", "); // accessible name

  var Z = 2147483000; // just below max int — sit above typical host UI

  var css =
    "#yopey-launcher{position:fixed;bottom:20px;" + side + ":20px;z-index:" + Z + ";" +
    "display:flex;align-items:center;gap:10px;border:0;cursor:pointer;text-align:left;background:" + accent + ";" +
    "color:#1a1a1a;font:600 14px/1.35 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;" +
    "max-width:264px;padding:12px 16px;border-radius:18px;box-shadow:0 6px 24px rgba(0,0,0,.18);" +
    "transition:transform .15s,opacity .15s}" +
    "#yopey-launcher:hover{transform:translateY(-2px)}" +
    "#yopey-launcher.yopey-hide{opacity:0;pointer-events:none;transform:scale(.9)}" +
    "#yopey-launcher svg{width:22px;height:22px;flex:none}" +
    "#yopey-launcher .yopey-txt{display:flex;flex-direction:column;gap:1px}" +
    "#yopey-launcher .yopey-head{font-weight:800}" +
    "#yopey-panel{position:fixed;bottom:20px;" + side + ":20px;z-index:" + (Z + 1) + ";" +
    "display:flex;flex-direction:column;width:400px;height:640px;max-height:calc(100vh - 40px);" +
    "background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 16px 50px rgba(0,0,0,.30);" +
    "opacity:0;transform:translateY(16px) scale(.98);pointer-events:none;" +
    "transition:opacity .2s,transform .2s}" +
    "body.yopey-open #yopey-panel{opacity:1;transform:none;pointer-events:auto}" +
    "#yopey-bar{display:flex;align-items:center;justify-content:space-between;flex:none;" +
    "padding:10px 8px 10px 16px;background:" + accent + ";" +
    "color:#1a1a1a;font:600 14px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif}" +
    "#yopey-bar span{display:flex;align-items:baseline;gap:6px}" +
    "#yopey-bar b{font-weight:800;letter-spacing:.02em}" +
    "#yopey-bar i{font-style:italic;font-weight:600;opacity:.75;font-size:13px}" +
    "#yopey-close{border:0;background:transparent;cursor:pointer;font-size:18px;line-height:1;" +
    "color:#1a1a1a;width:32px;height:32px;border-radius:8px}" +
    "#yopey-close:hover{background:rgba(0,0,0,.12)}" +
    "#yopey-iframe{flex:1;width:100%;border:0;display:block}" +
    "@media(max-width:480px){" +
    "#yopey-panel{inset:0;width:100%;height:100%;max-height:none;border-radius:0;transform:translateY(100%)}" +
    "body.yopey-open #yopey-panel{transform:none}" +
    "#yopey-launcher{border-radius:999px;padding:14px}" +
    "#yopey-launcher .yopey-txt{display:none}}";

  var style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  var chatIcon =
    '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
    '<path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" ' +
    'stroke="#1a1a1a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var launcher = document.createElement("button");
  launcher.type = "button";
  launcher.id = "yopey-launcher";
  launcher.setAttribute("aria-label", labelText);
  launcher.innerHTML = chatIcon + '<span class="yopey-txt"></span>';
  var txt = launcher.querySelector(".yopey-txt");
  labelLines.forEach(function (line, i) {
    var d = document.createElement("span");
    d.className = "yopey-line" + (i === 0 ? " yopey-head" : "");
    d.textContent = line;
    txt.appendChild(d);
  });

  var panel = null;
  var isOpen = false;

  function build() {
    panel = document.createElement("div");
    panel.id = "yopey-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "YOPEY Befriender");

    var bar = document.createElement("div");
    bar.id = "yopey-bar";
    bar.innerHTML = "<span><b>YOPEY</b><i>Befriender</i></span>";

    var close = document.createElement("button");
    close.type = "button";
    close.id = "yopey-close";
    close.setAttribute("aria-label", "Close chat");
    close.innerHTML = "&#10005;";
    close.addEventListener("click", closeWidget);
    bar.appendChild(close);

    var iframe = document.createElement("iframe");
    iframe.id = "yopey-iframe";
    iframe.title = "YOPEY Befriender chat";
    iframe.src = iframeUrl;
    iframe.allow = "clipboard-write";

    panel.appendChild(bar);
    panel.appendChild(iframe);
    document.body.appendChild(panel);
  }

  function openWidget() {
    if (!panel) build();
    // Next frame, so the opening transition actually animates.
    requestAnimationFrame(function () {
      document.body.classList.add("yopey-open");
    });
    isOpen = true;
    launcher.classList.add("yopey-hide");
  }

  function closeWidget() {
    document.body.classList.remove("yopey-open");
    isOpen = false;
    launcher.classList.remove("yopey-hide");
  }

  launcher.addEventListener("click", function () {
    if (isOpen) closeWidget();
    else openWidget();
  });

  // The framed app can ask to be closed (e.g. a future "done" button) by
  // posting a message; we only trust our own origin.
  window.addEventListener("message", function (e) {
    if (e.origin !== origin) return;
    if (e.data && e.data.type === "yopey-widget:close") closeWidget();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen) closeWidget();
  });

  if (document.body) {
    document.body.appendChild(launcher);
  } else {
    document.addEventListener("DOMContentLoaded", function () {
      document.body.appendChild(launcher);
    });
  }
})();
