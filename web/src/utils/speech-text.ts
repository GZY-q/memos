import type { Root, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";

const collectText = (node: RootContent): string => {
  if (node.type === "text" || node.type === "inlineCode") return node.value;
  if (node.type === "break") return "\n";
  // Skip raw HTML and media; they are not spoken content.
  if (node.type === "html" || node.type === "image" || node.type === "imageReference") {
    return "";
  }
  if (node.type === "code") return node.value;
  if (!("children" in node)) return "";
  const separator = ["list", "listItem", "blockquote", "table", "tableRow", "paragraph", "heading"].includes(node.type) ? "\n" : "";
  return node.children.map((child) => collectText(child as RootContent)).join(separator);
};

/**
 * Extracts readable plain text from memo markdown for speech synthesis.
 */
export const extractSpeechText = (content: string): string => {
  const source = content.trim();
  if (!source) return "";
  try {
    const tree: Root = fromMarkdown(source);
    return tree.children
      .map((child) => collectText(child))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  } catch {
    return source
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/[#>*_`~-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
};
