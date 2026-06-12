import type { ReactNode } from "react";
import styles from "./ScoutWindow.module.css";

/**
 * Minimal macOS window chrome (traffic-light titlebar + bordered body) for the
 * focused Scout studies. Reads only `--s-*` tokens, so it adopts whichever skin
 * the surrounding `data-scout-skin` wrapper selects. Pass `rail` to show the app
 * sidebar alongside the surface; omit it to focus on the surface alone.
 */
export function ScoutWindow({
  title = "scout · arts-mac-mini",
  rail,
  children,
}: {
  title?: string;
  rail?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.win}>
      <div className={styles.titlebar}>
        <div className={styles.lights}>
          <span className={`${styles.light} ${styles.red}`} />
          <span className={`${styles.light} ${styles.yellow}`} />
          <span className={`${styles.light} ${styles.green}`} />
        </div>
        <span className={styles.title}>{title}</span>
        <span className={styles.lights} aria-hidden />
      </div>
      <div className={styles.body}>
        {rail}
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
