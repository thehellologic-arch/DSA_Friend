import ReactMarkdown from "react-markdown";

export default function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="md-msg">
      <ReactMarkdown
        components={{
          pre: ({ children }) => <pre className="md-pre">{children}</pre>,
          code: ({ className, children, ...props }) => {
            const inline = !className;
            if (inline) {
              return (
                <code className="md-code-inline" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className={`md-code-block ${className ?? ""}`} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
