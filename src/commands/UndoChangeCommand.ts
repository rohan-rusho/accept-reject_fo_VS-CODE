import { ChangeManager } from '../core/ChangeManager';

export async function executeUndoChange(manager: ChangeManager): Promise<void> {
  await manager.undoLastChange();
}
