# YOPEY Befriender — setup guide for the team

Two short jobs, no coding needed:

1. **Coordinators** create their own dashboard login.
2. **The website person** adds the chatbot to the WordPress site.

Your live website is: **https://yopey-befriender.vercel.app**

---

## Part 1 — Create your dashboard login (each coordinator does this once)

The dashboard is where you see who has signed up, who is waiting for a reply,
survey results, and safeguarding alerts. Every coordinator has their **own**
login. There is no shared password.

**You need a `@yopey.org` email address** (only yopey.org emails are allowed in).

1. Go to **https://yopey-befriender.vercel.app/dashboard**
2. Click **"First time here? Create an account"**.
3. Enter your **@yopey.org email** and choose a **password** (at least 10 characters).
4. Click **"Send me a code"**.
5. Check your email inbox for a message from YOPEY with a **6 digit code**
   (it arrives within a minute; check spam if you don't see it). The code
   expires in 15 minutes.
6. Type the 6 digit code and click **"Verify"**.
7. You're in. Your email shows at the top right of the dashboard.

**Next time you visit**, just use **"Sign in"** with your email and password —
no code needed.

**To change your password:** sign in, then click **"Change password"** at the
top right.

**Forgot which email you used?** Only `@yopey.org` addresses work, so it's your
work email. If you forget your password, create the account again with the same
email and a new password, then verify with a fresh code.

> Only give dashboard logins to staff who need them. Removing someone's account
> immediately blocks their access.

---

## Part 2 — Add the chatbot to the WordPress website

This puts a floating **"Find a care home"** button on the site. When a visitor
clicks it, the whole YOPEY flow (sign up → find nearby care homes → draft an
introduction email) opens in a popup. **No keys, no plugins required, no changes
to the server** — it just loads the YOPEY site inside a small window.

### The one line you add

```html
<script src="https://yopey-befriender.vercel.app/widget.js" async></script>
```

### Where to paste it in WordPress

Pick whichever matches your setup:

**Option A — using a header/footer plugin (recommended, easiest)**
1. In WordPress admin, install and activate a plugin such as **WPCode** or
   **Insert Headers and Footers** (free).
2. Open its settings and find the **Footer** (or **Body**) box.
3. Paste the one line above.
4. **Save**. Done — the button now appears on every page.

**Option B — theme editor (if you're comfortable with it)**
1. WordPress admin → **Appearance → Theme File Editor**.
2. Open **`footer.php`**.
3. Paste the one line **just before** the `</body>` tag.
4. **Update file**.

> Tip: Option A is safer because theme updates can overwrite `footer.php`.

### Optional — customise the button

Add any of these `data-` attributes to the same line:

```html
<script
  src="https://yopey-befriender.vercel.app/widget.js"
  data-yopey-position="right"
  data-yopey-label="Find a care home"
  data-yopey-color="#FFAD00"
  async></script>
```

- `data-yopey-position` — `left` or `right` (default `right`)
- `data-yopey-label` — the text on the button
- `data-yopey-color` — button colour (hex)

### Check it works

1. Open the live WordPress site (not the editor) in a normal browser tab.
2. Look for the floating button (bottom corner).
3. Click it — the sign-up form should open in a popup.
4. Try a real UK postcode and confirm care homes appear.

Want to preview it first? There's a demo page here:
**https://yopey-befriender.vercel.app/widget-demo.html**

### If the button doesn't open

- Make sure you pasted the line exactly, with the real address
  `https://yopey-befriender.vercel.app/widget.js`.
- If the site uses a security plugin that blocks "iframes" or sets a
  `frame-ancestors` / `X-Frame-Options` rule, allow framing for the page (most
  WordPress sites don't set this, so it usually just works).
- Some browsers (especially Safari) may ask a returning visitor to sign up
  again — a single visit always works end to end.

---

## Who to contact

Questions about the tool itself: **hello@yopey.org**.
