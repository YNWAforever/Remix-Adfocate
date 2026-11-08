import { Children, cloneElement, isValidElement, type HTMLAttributes, type ReactElement, type ReactNode, type TableHTMLAttributes } from "react";

type Element = ReactElement<HTMLAttributes<HTMLElement> & { children?: ReactNode }>;
const elements = (children: ReactNode) => Children.toArray(children).filter(isValidElement) as Element[];
const text = (node: ReactNode): string => typeof node === "string" || typeof node === "number" ? String(node) : isValidElement<{ children?: ReactNode }>(node) ? Children.toArray(node.props.children).map(text).join(" ") : "";

/** Native table on desktop; labelled rows on mobile. No duplicated buttons/state. */
export function StudioTable({ children, className = "", ...props }: TableHTMLAttributes<HTMLTableElement>) {
  const sections = elements(children);
  const head = sections.find(section => section.type === "thead");
  const labels = elements(elements(head?.props.children)[0]?.props.children).map(cell => text(cell.props.children));
  return <table {...props} className={`s-responsive-table ${className}`} role="table">
    {sections.map(section => {
      if (section.type !== "tbody") return section;
      const rows = elements(section.props.children).map(row => {
        const cells = elements(row.props.children).map((cell, index) => cloneElement(cell, { role: "cell" }, <>
          {labels[index] && <span className="s-cell-label" aria-hidden="true">{labels[index]}</span>}
          <div className="s-cell-value">{cell.props.children}</div>
        </>));
        return cloneElement(row, { role: "row" }, cells);
      });
      return cloneElement(section, { role: "rowgroup" }, rows);
    })}
  </table>;
}
