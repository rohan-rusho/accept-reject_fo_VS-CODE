import { ChangeManager } from '../core/ChangeManager';

export async function executeRejectAll(manager: ChangeManager): Promise<void> {
  await manager.rejectAll();
}
