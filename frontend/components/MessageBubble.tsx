type Props = {
  role: "user" | "assistant";
  content: string;
};

// Linkify URLs and emails so they're clickable in chat
function linkify(text: string): (string | JSX.Element)[] {
  const pattern = /(https?:\/\/[^\s]+|[\w.+-]+@[\w-]+\.[\w.-]+)/g;
  const parts = text.split(pattern);
  return parts.map((part, i) => {
    if (!part) return part;
    if (/^https?:\/\//.test(part)) {
      return (
        <a key={i} href={part} target="_blank" rel="noreferrer">
          {part}
        </a>
      );
    }
    if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(part)) {
      return (
        <a key={i} href={`mailto:${part}`}>
          {part}
        </a>
      );
    }
    return part;
  });
}

export default function MessageBubble({ role, content }: Props) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} animate-fade-in`}>
      <div
        className={`chat-prose max-w-[85%] md:max-w-[75%] px-4 py-2.5 rounded-2xl text-[15px] leading-relaxed ${
          isUser
            ? "bg-yopey-primary text-white rounded-tr-md shadow-sm"
            : "bg-white text-gray-800 rounded-tl-md shadow-sm border border-gray-100"
        }`}
      >
        {linkify(content)}
      </div>
    </div>
  );
}
