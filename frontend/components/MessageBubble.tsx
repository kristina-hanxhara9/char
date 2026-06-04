type Props = {
  role: "user" | "assistant";
  content: string;
};

type Token =
  | { type: "text"; value: string }
  | { type: "bold"; value: string }
  | { type: "link"; text: string; url: string }
  | { type: "url"; url: string }
  | { type: "email"; address: string };

// Combined regex matches, in priority order:
//   1. markdown link  [text](url)
//   2. markdown bold  **text**  or  __text__
//   3. bare URL       https://...
//   4. email          name@host
const TOKEN_RE =
  /(\[([^\]\n]+)\]\(([^)\s]+)\))|(\*\*([^*\n]+)\*\*|__([^_\n]+)__)|(https?:\/\/[^\s)\]]+)|([\w.+-]+@[\w-]+\.[\w.-]+)/g;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m.index > lastIndex) {
      tokens.push({ type: "text", value: text.slice(lastIndex, m.index) });
    }
    if (m[1]) {
      // [text](url)
      tokens.push({ type: "link", text: m[2], url: m[3] });
    } else if (m[4]) {
      // **bold** or __bold__
      tokens.push({ type: "bold", value: m[5] || m[6] });
    } else if (m[7]) {
      // bare URL
      tokens.push({ type: "url", url: m[7] });
    } else if (m[8]) {
      // email
      tokens.push({ type: "email", address: m[8] });
    }
    lastIndex = TOKEN_RE.lastIndex;
  }
  if (lastIndex < text.length) {
    tokens.push({ type: "text", value: text.slice(lastIndex) });
  }
  return tokens;
}

function renderTokens(tokens: Token[]): JSX.Element[] {
  return tokens.map((t, i) => {
    switch (t.type) {
      case "text":
        return <span key={i}>{t.value}</span>;
      case "bold":
        return <strong key={i}>{t.value}</strong>;
      case "link":
        return (
          <a key={i} href={t.url} target="_blank" rel="noreferrer">
            {t.text}
          </a>
        );
      case "url":
        return (
          <a key={i} href={t.url} target="_blank" rel="noreferrer">
            {t.url}
          </a>
        );
      case "email":
        return (
          <a key={i} href={`mailto:${t.address}`}>
            {t.address}
          </a>
        );
    }
  });
}

export default function MessageBubble({ role, content }: Props) {
  const isUser = role === "user";
  // Don't render markdown for the user's own messages — show their input as-is.
  const tokens = isUser
    ? [{ type: "text" as const, value: content }]
    : tokenize(content);

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} animate-fade-in`}>
      <div
        className={`chat-prose max-w-[85%] md:max-w-[75%] px-4 py-2.5 rounded-2xl text-[15px] leading-relaxed ${
          isUser
            ? "bg-yopey-primary text-white rounded-tr-md shadow-sm"
            : "bg-white text-gray-800 rounded-tl-md shadow-sm border border-gray-100"
        }`}
      >
        {renderTokens(tokens)}
      </div>
    </div>
  );
}
