import { ChangeManager } from '../core/ChangeManager';

export async function executeAcceptAll(manager: ChangeManager): Promise<void> {
  await manager.acceptAll();
}
