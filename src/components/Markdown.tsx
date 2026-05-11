import { Streamdown } from "streamdown";

interface Props {
  text?: string;
  truncate?: number;
  className?: string;
}

export default function Markdown({ text, truncate, className }: Props) {
  if (!text) return null;
  let body = text;
  if (truncate && body.length > truncate) {
    body = body.slice(0, truncate).trimEnd() + "…";
  }
  return (
    <div className={className ? `md ${className}` : "md"}>
      <Streamdown>{body}</Streamdown>
    </div>
  );
}
