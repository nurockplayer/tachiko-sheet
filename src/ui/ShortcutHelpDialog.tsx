import { Modal } from "./Modal.js";
import { shortcutHelpGroups } from "./shortcut-help.js";

export function ShortcutHelpDialogView({ mac, desktop, onClose }: { mac: boolean; desktop: boolean; onClose(): void }) {
  return <Modal label="Keyboard shortcuts" variant="review" onCancel={onClose}>
    <div className="ts-dialog-intro"><h2 className="ts-h2">Keyboard shortcuts</h2></div>
    <div className="ts-shortcut-help-body" tabIndex={0} role="region" aria-label="Shortcuts">
      {shortcutHelpGroups({ mac, desktop }).map(group => <section key={group.name}>
        <h3>{group.name}</h3>
        <dl>{group.entries.map(entry => <div key={entry.action}>
          <dt>{entry.keys.map((key, index) => <span key={key}>{index > 0 ? " / " : null}<kbd>{key}</kbd></span>)}</dt>
          <dd>{entry.action}</dd>
        </div>)}</dl>
      </section>)}
    </div>
    <div className="ts-dialog-actions"><button type="button" className="ts-button" data-autofocus="true" onClick={onClose}>Close</button></div>
  </Modal>;
}

export const ShortcutHelpDialog = ShortcutHelpDialogView;
