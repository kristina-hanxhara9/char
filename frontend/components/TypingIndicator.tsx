export default function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-md px-4 py-3 shadow-sm">
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
      </div>
    </div>
  );
}
