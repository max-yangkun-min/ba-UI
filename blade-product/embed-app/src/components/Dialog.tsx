import type { ReactNode } from "react";
import { Icon } from "./Icon";

type DialogProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
};

export function Dialog({ title, onClose, children, footer }: DialogProps) {
  return (
    <div className="dialog-mask" role="presentation" onClick={onClose}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-hd">
          <h3>{title}</h3>
          <button className="icon-btn" type="button" aria-label="关闭" onClick={onClose}>
            <Icon name="close-line" />
          </button>
        </div>
        <div className="dialog-bd">{children}</div>
        {footer ? <div className="dialog-ft">{footer}</div> : null}
      </div>
    </div>
  );
}
